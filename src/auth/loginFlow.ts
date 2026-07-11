import http from 'node:http';
import { exec } from 'node:child_process';
import { generatePkce, generateState } from './pkce.js';
import { discoverOidc, buildAuthUrl, exchangeCodeForTokens, validateIdToken, refreshEntraTokens } from './oidc.js';
import { issueAccessToken } from './jwt.js';
import { saveTokens, loadTokens, isTokenExpired } from './store.js';
import { loadAuthConfig } from './config.js';
import { resolveRoles } from './roles.js';
import { eventBus } from '../events/eventBus.js';
import type { Principal, StoredTokens } from './types.js';

// Fixed callback port — must match the redirect URI registered in Entra ID app registration.
// One above the Mission Control service port (7342) so it's predictable and easy to document.
export const CALLBACK_PORT = 7343;
export const CALLBACK_PATH = '/callback';
export const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? `open "${url}"` :
    process.platform === 'win32'  ? `start "" "${url}"` :
    `xdg-open "${url}"`;

  exec(cmd, err => {
    if (err) {
      console.log(`\nCould not open browser automatically. Navigate to:\n${url}\n`);
    }
  });
}

/**
 * Attempt to silently refresh the ctxhub token using the stored Entra refresh token.
 * Returns null if refresh fails (user must re-run ctxhub login).
 */
export async function refreshSession(): Promise<Principal | null> {
  const config = await loadAuthConfig();
  const tokens = await loadTokens();

  if (!config || !tokens) return null;

  try {
    const discovery = await discoverOidc(config.oidc.tenantId);
    const entraTokens = await refreshEntraTokens(discovery, config.oidc, tokens.entraTokens.refreshToken);
    const idPayload = await validateIdToken(entraTokens.id_token, discovery, config.oidc);

    const sub = String(idPayload['oid'] ?? idPayload['sub']);
    const email = String(idPayload['email'] ?? idPayload['preferred_username'] ?? tokens.user.email);
    const name = String(idPayload['name'] ?? tokens.user.name);
    const roles = resolveRoles(idPayload, sub, config.roleMap);
    const tenantId = String(idPayload['tid'] ?? '');
    const principal: Principal = { sub, email, name, roles, tenantId };

    const { token, expiresAt } = issueAccessToken(principal, config.jwtSecret);
    const entraExpiry = new Date(Date.now() + entraTokens.expires_in * 1000).toISOString();

    const updated: StoredTokens = {
      ...tokens,
      entraTokens: {
        accessToken: entraTokens.access_token,
        refreshToken: entraTokens.refresh_token,
        idToken: entraTokens.id_token,
        expiresAt: entraExpiry,
      },
      ctxhubToken: { token, expiresAt },
      user: { sub, email, name },
    };
    await saveTokens(updated);
    try { eventBus.publish({ type: 'auth.token_refresh', sub, email }); } catch { /* audit failure must not break auth */ }
    return principal;
  } catch {
    return null;
  }
}

/**
 * Get the current valid ctxhub access token, refreshing silently if expired.
 * Returns null if the user is not logged in or cannot be refreshed.
 */
export async function getValidToken(): Promise<string | null> {
  const config = await loadAuthConfig();
  const tokens = await loadTokens();

  if (!config || !tokens) return null;

  // Token still valid
  if (!isTokenExpired(tokens.ctxhubToken.expiresAt)) {
    return tokens.ctxhubToken.token;
  }

  // Try silent refresh
  const principal = await refreshSession();
  if (!principal) return null;

  const refreshed = await loadTokens();
  return refreshed?.ctxhubToken.token ?? null;
}

/**
 * Full interactive PKCE login flow.
 * Starts a local callback server, opens the browser, waits for the auth code,
 * exchanges it for tokens, validates the ID token via JWKS, and stores everything.
 */
export async function runLoginFlow(): Promise<Principal> {
  const config = await loadAuthConfig();
  if (!config) {
    throw new Error('Auth not configured. Run: ctxhub auth configure');
  }

  const discovery = await discoverOidc(config.oidc.tenantId);
  const { verifier, challenge } = generatePkce();
  const state = generateState();
  const authUrl = buildAuthUrl(discovery, config.oidc, challenge, state);

  return new Promise<Principal>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (!req.url?.startsWith(CALLBACK_PATH)) {
          res.writeHead(404).end();
          return;
        }

        const callbackUrl = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
        const error = callbackUrl.searchParams.get('error');
        const returnedState = callbackUrl.searchParams.get('state');
        const code = callbackUrl.searchParams.get('code');

        if (error) {
          const desc = callbackUrl.searchParams.get('error_description') ?? error;
          res.writeHead(400, { 'Content-Type': 'text/html' }).end(callbackPage(false, desc));
          server.close();
          reject(new Error(`Auth error: ${desc}`));
          return;
        }

        if (!code || returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' }).end(callbackPage(false, 'Invalid callback parameters'));
          server.close();
          reject(new Error('Invalid callback: missing code or state mismatch'));
          return;
        }

        // Exchange auth code for tokens
        const entraTokens = await exchangeCodeForTokens(discovery, config.oidc, code, verifier);

        // Validate the ID token signature against Entra ID's JWKS
        const idPayload = await validateIdToken(entraTokens.id_token, discovery, config.oidc);

        const sub = String(idPayload['oid'] ?? idPayload['sub']);
        const email = String(idPayload['email'] ?? idPayload['preferred_username'] ?? '');
        const name = String(idPayload['name'] ?? email);
        const roles = resolveRoles(idPayload, sub, config.roleMap);
        const tenantId = String(idPayload['tid'] ?? '');
        const principal: Principal = { sub, email, name, roles, tenantId };

        const { token, expiresAt } = issueAccessToken(principal, config.jwtSecret);
        const entraExpiry = new Date(Date.now() + entraTokens.expires_in * 1000).toISOString();

        const stored: StoredTokens = {
          version: 1,
          entraTokens: {
            accessToken: entraTokens.access_token,
            refreshToken: entraTokens.refresh_token,
            idToken: entraTokens.id_token,
            expiresAt: entraExpiry,
          },
          ctxhubToken: { token, expiresAt },
          user: { sub, email, name },
        };
        await saveTokens(stored);

        res.writeHead(200, { 'Content-Type': 'text/html' }).end(callbackPage(true, `Signed in as ${email}`));
        server.close();
        try { eventBus.publish({ type: 'auth.login', sub, email, name, roles, provider: 'entra' }); } catch { /* audit failure must not break auth */ }
        resolve(principal);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Login failed';
        res.writeHead(500, { 'Content-Type': 'text/html' }).end(callbackPage(false, message));
        server.close();
        try { eventBus.publish({ type: 'auth.login_failed', error: message }); } catch { /* audit failure must not break auth */ }
        reject(new Error(message));
      }
    });

    server.listen(CALLBACK_PORT, '127.0.0.1', () => {
      console.log('\nOpening browser for authentication...');
      console.log(`If it didn't open automatically, navigate to:\n${authUrl}\n`);
      openBrowser(authUrl);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${CALLBACK_PORT} is already in use. Stop any other ctxhub login in progress and try again.`));
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

function callbackPage(success: boolean, message: string): string {
  const icon = success ? '✓' : '✗';
  const color = success ? '#22c55e' : '#ef4444';
  const title = success ? 'Signed in to ctxhub' : 'Sign in failed';
  const subtitle = success ? '<p>You can close this tab and return to your terminal.</p>' : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0;
      background: #09090b; color: #fafafa;
    }
    .card {
      text-align: center; padding: 2.5rem 2rem;
      border: 1px solid #27272a; border-radius: 12px;
      max-width: 400px; width: 100%;
    }
    .icon { font-size: 2.5rem; color: ${color}; margin-bottom: 0.5rem; }
    h1 { font-size: 1.125rem; font-weight: 600; margin: 0 0 0.5rem; }
    p { color: #a1a1aa; font-size: 0.875rem; margin: 0.25rem 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    ${subtitle}
  </div>
</body>
</html>`;
}
