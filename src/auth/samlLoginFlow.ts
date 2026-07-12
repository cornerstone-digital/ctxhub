/**
 * SAML equivalent of loginFlow.ts's runLoginFlow() -- SP-initiated login driven by the CLI: a
 * local temp HTTP server acts as this session's Assertion Consumer Service, the browser opens
 * to the IdP, and the IdP POSTs the SAMLResponse back to localhost when the user finishes
 * authenticating there. Downstream (role resolution, JWT issuance, token storage) is
 * identical to the OIDC flow -- only how the identity gets established differs.
 */
import http from 'node:http';
import { exec } from 'node:child_process';
import { getSamlAuthorizeUrl, validateSamlResponse } from './saml.js';
import { issueAccessToken } from './jwt.js';
import { saveTokens } from './store.js';
import { loadAuthConfig } from './config.js';
import { resolveRoles } from './roles.js';
import { eventBus } from '../events/eventBus.js';
import type { Principal, StoredTokens } from './types.js';

export const SAML_CALLBACK_PORT = 7343;
export const SAML_CALLBACK_PATH = '/saml/acs';

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? `open "${url}"` :
    process.platform === 'win32' ? `start "" "${url}"` :
    `xdg-open "${url}"`;
  exec(cmd, err => {
    if (err) console.log(`\nCould not open browser automatically. Navigate to:\n${url}\n`);
  });
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function callbackPage(success: boolean, message: string): string {
  const icon = success ? '✓' : '✗';
  const color = success ? '#22c55e' : '#ef4444';
  const title = success ? 'Signed in to ctxhub' : 'Sign in failed';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${title}</title>
<style>*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#09090b;color:#fafafa}.card{text-align:center;padding:2.5rem 2rem;border:1px solid #27272a;border-radius:12px;max-width:400px;width:100%}.icon{font-size:2.5rem;color:${color};margin-bottom:.5rem}h1{font-size:1.125rem;font-weight:600;margin:0 0 .5rem}p{color:#a1a1aa;font-size:.875rem;margin:.25rem 0}</style>
</head><body><div class="card"><div class="icon">${icon}</div><h1>${title}</h1><p>${message}</p>${success ? '<p>You can close this tab and return to your terminal.</p>' : ''}</div></body></html>`;
}

export async function runSamlLoginFlow(): Promise<Principal> {
  const config = await loadAuthConfig();
  if (!config?.saml) {
    throw new Error('SAML not configured. Run: ctxhub auth configure --provider saml ...');
  }
  const samlConfig = config.saml;

  const authorizeUrl = await getSamlAuthorizeUrl(samlConfig);

  return new Promise<Principal>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (req.method !== 'POST' || !req.url?.startsWith(SAML_CALLBACK_PATH)) {
          res.writeHead(404).end();
          return;
        }

        const body = await readBody(req);
        const params = new URLSearchParams(body);
        const samlResponse = params.get('SAMLResponse');
        if (!samlResponse) {
          res.writeHead(400, { 'Content-Type': 'text/html' }).end(callbackPage(false, 'No SAMLResponse in callback'));
          server.close();
          reject(new Error('Invalid SAML callback: missing SAMLResponse'));
          return;
        }

        const profile = await validateSamlResponse(samlConfig, samlResponse);
        const roles = resolveRoles({ groups: profile.groups }, profile.nameId, config.roleMap);
        const principal: Principal = { sub: profile.nameId, email: profile.email, name: profile.name, roles };

        const { token, expiresAt } = issueAccessToken(principal, config.jwtSecret);
        const stored: StoredTokens = {
          version: 1,
          samlSession: { sessionIndex: profile.raw.sessionIndex, expiresAt },
          ctxhubToken: { token, expiresAt },
          user: { sub: profile.nameId, email: profile.email, name: profile.name },
        };
        await saveTokens(stored);

        res.writeHead(200, { 'Content-Type': 'text/html' }).end(callbackPage(true, `Signed in as ${profile.email}`));
        server.close();
        try { eventBus.publish({ type: 'auth.login', sub: profile.nameId, email: profile.email, name: profile.name, roles, provider: 'saml' }); } catch { /* audit failure must not break auth */ }
        resolve(principal);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Login failed';
        res.writeHead(500, { 'Content-Type': 'text/html' }).end(callbackPage(false, message));
        server.close();
        try { eventBus.publish({ type: 'auth.login_failed', error: message }); } catch { /* audit failure must not break auth */ }
        reject(new Error(message));
      }
    });

    server.listen(SAML_CALLBACK_PORT, '127.0.0.1', () => {
      console.log('\nOpening browser for authentication...');
      console.log(`If it didn't open automatically, navigate to:\n${authorizeUrl}\n`);
      openBrowser(authorizeUrl);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${SAML_CALLBACK_PORT} is already in use. Stop any other ctxhub login in progress and try again.`));
      } else {
        reject(err);
      }
    });

    setTimeout(() => {
      server.close();
      reject(new Error('Login timed out after 5 minutes'));
    }, LOGIN_TIMEOUT_MS);
  });
}
