import { randomBytes, createHash } from 'node:crypto';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Generate a PKCE (Proof Key for Code Exchange) pair.
 * - verifier: kept secret by the client, sent at token exchange time
 * - challenge: S256 hash of the verifier, sent in the auth URL
 * RFC 7636 §4.1-4.2
 */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(
    Buffer.from(createHash('sha256').update(verifier).digest()),
  );
  return { verifier, challenge };
}

/** Random opaque state value for CSRF protection */
export function generateState(): string {
  return randomBytes(16).toString('hex');
}
