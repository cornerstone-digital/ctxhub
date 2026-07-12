import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { getCtxhubHome } from '../workspaces/registry.js';
import { pathExists, readText, writeText } from '../utils/fs.js';
import type { AuthConfig, OidcConfig, RoleMap, SamlConfig } from './types.js';

export function getAuthConfigPath(): string {
  return path.join(getCtxhubHome(), 'auth.json');
}

/**
 * Read the four auth-related environment variables.
 * Returns an object with whichever of the four are set (undefined otherwise).
 */
function readAuthEnvVars(): {
  tenantId: string | undefined;
  clientId: string | undefined;
  clientSecret: string | undefined;
  jwtSecret: string | undefined;
} {
  return {
    tenantId: process.env['CTXHUB_TENANT_ID'],
    clientId: process.env['CTXHUB_CLIENT_ID'],
    clientSecret: process.env['CTXHUB_CLIENT_SECRET'],
    jwtSecret: process.env['CTXHUB_JWT_SECRET'],
  };
}

/**
 * Load the auth config, overlaying any CTXHUB_* environment variables on top of
 * the file-based config.  Environment variables always take precedence.
 *
 * If all four env vars are present, a valid AuthConfig is returned even when the
 * file does not exist.  If only some env vars are present they are merged with the
 * file config.  If neither source produces a complete config, null is returned.
 */
export async function loadAuthConfig(): Promise<AuthConfig | null> {
  const env = readAuthEnvVars();
  const allEnvVarsPresent =
    Boolean(env.tenantId) &&
    Boolean(env.clientId) &&
    Boolean(env.clientSecret) &&
    Boolean(env.jwtSecret);

  // Try to read file config
  let fileConfig: AuthConfig | null = null;
  const configPath = getAuthConfigPath();
  if (await pathExists(configPath)) {
    try {
      const raw = await readText(configPath);
      fileConfig = JSON.parse(raw) as AuthConfig;
    } catch {
      fileConfig = null;
    }
  }

  // If all env vars are present, build from env (use file redirectUri if available, else empty)
  if (allEnvVarsPresent) {
    const oidc: OidcConfig = {
      provider: fileConfig?.oidc?.provider ?? 'entra',
      tenantId: env.tenantId!,
      clientId: env.clientId!,
      clientSecret: env.clientSecret!,
      redirectUri: fileConfig?.oidc?.redirectUri ?? '',
      ...(fileConfig?.oidc?.issuerUrl ? { issuerUrl: fileConfig.oidc.issuerUrl } : {}),
    };
    return {
      version: 1,
      oidc,
      jwtSecret: env.jwtSecret!,
      ...(fileConfig?.roleMap ? { roleMap: fileConfig.roleMap } : {}),
    };
  }

  // If no env vars at all, return file config as-is
  if (!env.tenantId && !env.clientId && !env.clientSecret && !env.jwtSecret) {
    return fileConfig;
  }

  // Partial env vars: merge with file config (env wins)
  if (!fileConfig) return null;

  const oidc: OidcConfig = {
    ...(fileConfig.oidc ?? {}),
    tenantId: env.tenantId ?? fileConfig.oidc?.tenantId,
    clientId: env.clientId ?? fileConfig.oidc?.clientId ?? '',
    clientSecret: env.clientSecret ?? fileConfig.oidc?.clientSecret ?? '',
    redirectUri: fileConfig.oidc?.redirectUri ?? '',
  };

  return {
    ...fileConfig,
    oidc,
    jwtSecret: env.jwtSecret ?? fileConfig.jwtSecret,
  };
}

export async function saveAuthConfig(config: AuthConfig): Promise<void> {
  await writeText(getAuthConfigPath(), `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * Initialise or update auth config. Preserves the existing JWT signing key if
 * one already exists so that in-flight tokens remain valid after reconfiguration.
 */
export async function initAuthConfig(oidc: OidcConfig): Promise<AuthConfig> {
  const existing = await loadAuthConfig();
  const config: AuthConfig = {
    version: 1,
    protocol: 'oidc',
    oidc,
    jwtSecret: existing?.jwtSecret ?? randomBytes(32).toString('hex'),
  };
  await saveAuthConfig(config);
  return config;
}

/**
 * AuthConfig.oidc is required regardless of protocol (see its doc comment in types.ts) to
 * avoid touching every existing OIDC-only caller -- these placeholder values are never read
 * when protocol is 'saml'.
 */
export async function initSamlAuthConfig(saml: SamlConfig): Promise<AuthConfig> {
  const existing = await loadAuthConfig();
  const config: AuthConfig = {
    version: 1,
    protocol: 'saml',
    oidc: { clientId: '', clientSecret: '', redirectUri: '' },
    saml,
    jwtSecret: existing?.jwtSecret ?? randomBytes(32).toString('hex'),
  };
  await saveAuthConfig(config);
  return config;
}

/**
 * Update the role mapping in auth.json, preserving all other fields.
 */
export async function updateRoleMap(roleMap: RoleMap): Promise<void> {
  const existing = await loadAuthConfig();
  if (!existing) throw new Error('Auth not configured. Run: ctxhub auth configure');
  await saveAuthConfig({ ...existing, roleMap });
}

export async function isAuthConfigured(): Promise<boolean> {
  const config = await loadAuthConfig();
  if (config === null) return false;
  if (!config.jwtSecret) return false;

  if (config.protocol === 'saml') {
    const saml = config.saml;
    return Boolean(saml?.idpEntryPoint && saml.idpIssuer && saml.idpCert && saml.spEntityId && saml.callbackUrl);
  }

  if (!config.oidc?.clientId) return false;
  if (!config.oidc?.clientSecret) return false;
  // For Entra provider (or legacy configs without explicit provider), tenantId is required
  const provider = config.oidc?.provider;
  if (!provider || provider === 'entra') {
    return Boolean(config.oidc?.tenantId);
  }
  // For generic/okta/google, issuerUrl is required instead
  return Boolean(config.oidc?.issuerUrl);
}

/**
 * Initialise or update auth config for non-Entra OIDC providers.
 */
export async function initAuthConfigGeneric(opts: {
  provider: 'okta' | 'google' | 'generic';
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<AuthConfig> {
  const existing = await loadAuthConfig();
  const oidc: OidcConfig = {
    provider: opts.provider,
    issuerUrl: opts.issuerUrl,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    redirectUri: opts.redirectUri,
  };
  const config: AuthConfig = {
    version: 1,
    protocol: 'oidc',
    oidc,
    jwtSecret: existing?.jwtSecret ?? randomBytes(32).toString('hex'),
  };
  await saveAuthConfig(config);
  return config;
}
