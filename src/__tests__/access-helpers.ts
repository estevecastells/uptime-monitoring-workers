// Test helpers for Cloudflare Access authentication.
//
// These mint *real* RS256 JWTs with a throwaway keypair and serve the matching
// JWKS through a stubbed global fetch, so the verification path under test is
// the real one: signature checking included. Nothing here shortcuts the crypto.

export const TEST_TEAM_DOMAIN = 'testteam.cloudflareaccess.com';
export const TEST_ISSUER = `https://${TEST_TEAM_DOMAIN}`;
export const TEST_AUD = 'test-access-aud-tag';
export const TEST_KID = 'test-key-1';

let keyPair: CryptoKeyPair | null = null;

async function getKeyPair(): Promise<CryptoKeyPair> {
  if (!keyPair) {
    keyPair = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    )) as CryptoKeyPair;
  }
  return keyPair;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

export type TokenOptions = {
  aud?: string | string[];
  iss?: string;
  email?: string;
  expiresInSeconds?: number;
  notBeforeOffsetSeconds?: number;
  kid?: string;
  alg?: string;
  /** Sign with a different key, simulating a forged token. */
  useWrongKey?: boolean;
};

/** Mint a signed Access-style JWT. Defaults produce a valid token. */
export async function mintAccessToken(options: TokenOptions = {}): Promise<string> {
  const pair = await getKeyPair();
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: options.alg ?? 'RS256', kid: options.kid ?? TEST_KID, typ: 'JWT' };
  const payload = {
    aud: options.aud ?? TEST_AUD,
    iss: options.iss ?? TEST_ISSUER,
    email: options.email ?? 'owner@example.com',
    sub: 'test-subject',
    iat: now,
    nbf: now + (options.notBeforeOffsetSeconds ?? 0),
    exp: now + (options.expiresInSeconds ?? 3600),
  };

  const signingInput = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(payload)}`;

  let signingKey = pair.privateKey;
  if (options.useWrongKey) {
    const other = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    )) as CryptoKeyPair;
    signingKey = other.privateKey;
  }

  const signature = new Uint8Array(
    await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      signingKey,
      new TextEncoder().encode(signingInput)
    )
  );

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * Replace global fetch so the team's JWKS endpoint serves our test public key.
 * Any other request falls through to the original fetch. Returns a restore fn.
 */
export async function stubJwksEndpoint(): Promise<() => void> {
  const pair = await getKeyPair();
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const body = JSON.stringify({ keys: [{ ...jwk, kid: TEST_KID }] });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === `${TEST_ISSUER}/cdn-cgi/access/certs`) {
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}
