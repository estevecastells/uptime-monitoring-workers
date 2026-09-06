import type { Env } from '../types';

// ── Cloudflare Access (Zero Trust) authentication ──────────────────
//
// Access sits in front of this Worker at the edge and only forwards requests
// from users matching the application policy. It attaches a signed JWT in the
// `Cf-Access-Jwt-Assertion` header (also mirrored in the `CF_Authorization`
// cookie).
//
// We verify that JWT rather than trusting `Cf-Access-Authenticated-User-Email`
// on its own. A plain header can be forged by anyone who reaches the Worker
// outside of Access; a signature over the team's public key cannot. That
// matters here because a Worker stays reachable on its `workers.dev` hostname,
// so header trust alone is one misconfiguration away from being no auth at all.
//
// Verification checks, in order:
//   1. RS256 signature against the team's published JWKS
//   2. `aud` contains this application's AUD tag (a token minted for a
//      *different* app in the same team must not be accepted here)
//   3. `iss` matches the team domain
//   4. `exp` / `nbf` are within tolerance

const CLOCK_SKEW_S = 60;

// JWKS is cached per isolate. Access rotates keys and publishes both the
// current and previous key, so a short TTL is enough to pick up a rotation
// without re-fetching on every request.
const JWKS_TTL_MS = 60 * 60 * 1000;
let jwksCache: { keys: Map<string, CryptoKey>; fetchedAt: number; issuer: string } | null = null;

export type AccessIdentity = {
  email: string;
  sub: string;
};

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeJson<T>(input: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(input))) as T;
}

function teamIssuer(teamDomain: string): string {
  // Accept either "myteam" or a full "myteam.cloudflareaccess.com".
  const host = teamDomain.includes('.') ? teamDomain : `${teamDomain}.cloudflareaccess.com`;
  return `https://${host.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
}

async function getSigningKeys(issuer: string): Promise<Map<string, CryptoKey>> {
  const fresh = jwksCache
    && jwksCache.issuer === issuer
    && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  if (fresh) return jwksCache!.keys;

  const resp = await fetch(`${issuer}/cdn-cgi/access/certs`);
  if (!resp.ok) throw new Error(`Could not fetch Access JWKS: HTTP ${resp.status}`);

  const body = await resp.json<{ keys?: JsonWebKey[] }>();
  const keys = new Map<string, CryptoKey>();

  for (const jwk of body.keys ?? []) {
    const kid = (jwk as JsonWebKey & { kid?: string }).kid;
    if (!kid) continue;
    keys.set(
      kid,
      await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
      )
    );
  }

  if (!keys.size) throw new Error('Access JWKS contained no usable keys');

  jwksCache = { keys, fetchedAt: Date.now(), issuer };
  return keys;
}

type AccessClaims = {
  aud?: string | string[];
  email?: string;
  sub?: string;
  iss?: string;
  exp?: number;
  nbf?: number;
};

/**
 * Verify an Access JWT. Returns the identity on success, or null on any
 * failure — callers treat null as "not authenticated" and must not fall back
 * to a weaker check.
 */
export async function verifyAccessJwt(token: string, env: Env): Promise<AccessIdentity | null> {
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const expectedAud = env.ACCESS_AUD;
  if (!teamDomain || !expectedAud) {
    throw new Error('ACCESS_TEAM_DOMAIN and ACCESS_AUD must be configured');
  }

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { kid?: string; alg?: string };
  let claims: AccessClaims;
  try {
    header = base64UrlDecodeJson(headerB64);
    claims = base64UrlDecodeJson(payloadB64);
  } catch {
    return null;
  }

  // Pin the algorithm. Without this, a token declaring alg:"none" or an HMAC
  // algorithm could sidestep the public-key check entirely.
  if (header.alg !== 'RS256' || !header.kid) return null;

  const issuer = teamIssuer(teamDomain);
  if (claims.iss !== issuer) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < now) return null;
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_S > now) return null;

  const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!audiences.includes(expectedAud)) return null;

  const keys = await getSigningKeys(issuer);
  const key = keys.get(header.kid);
  if (!key) return null;

  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlDecode(signatureB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  );
  if (!verified) return null;

  return { email: (claims.email ?? '').toLowerCase().trim(), sub: claims.sub ?? '' };
}

/** Pull the Access token from the header, falling back to the cookie. */
export function readAccessToken(request: Request): string | null {
  const header = request.headers.get('Cf-Access-Jwt-Assertion');
  if (header) return header.trim();

  const cookie = request.headers.get('Cookie') ?? '';
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
