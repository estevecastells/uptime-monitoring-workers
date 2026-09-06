import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { verifyAccessJwt, readAccessToken } from '../auth/access';
import type { Env } from '../types';
import {
  mintAccessToken,
  stubJwksEndpoint,
  TEST_TEAM_DOMAIN,
  TEST_AUD,
  TEST_ISSUER,
} from './access-helpers';

const testEnv = {
  ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
  ACCESS_AUD: TEST_AUD,
} as unknown as Env;

let restoreFetch: () => void;

beforeAll(async () => {
  restoreFetch = await stubJwksEndpoint();
});

afterAll(() => {
  restoreFetch();
});

describe('verifyAccessJwt', () => {
  it('accepts a correctly signed token and returns the identity', async () => {
    const token = await mintAccessToken({ email: 'Owner@Example.com' });
    const identity = await verifyAccessJwt(token, testEnv);

    expect(identity).not.toBeNull();
    expect(identity!.email).toBe('owner@example.com');
  });

  it('rejects a token signed by a different key', async () => {
    const token = await mintAccessToken({ useWrongKey: true });
    expect(await verifyAccessJwt(token, testEnv)).toBeNull();
  });

  it('rejects a token minted for a different application (wrong aud)', async () => {
    const token = await mintAccessToken({ aud: 'some-other-apps-aud-tag' });
    expect(await verifyAccessJwt(token, testEnv)).toBeNull();
  });

  it('rejects a token from a different team (wrong issuer)', async () => {
    const token = await mintAccessToken({ iss: 'https://attacker.cloudflareaccess.com' });
    expect(await verifyAccessJwt(token, testEnv)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await mintAccessToken({ expiresInSeconds: -3600 });
    expect(await verifyAccessJwt(token, testEnv)).toBeNull();
  });

  it('rejects a token that is not valid yet', async () => {
    const token = await mintAccessToken({ notBeforeOffsetSeconds: 3600 });
    expect(await verifyAccessJwt(token, testEnv)).toBeNull();
  });

  it('rejects alg:none, so an unsigned token cannot bypass verification', async () => {
    const token = await mintAccessToken({ alg: 'none' });
    expect(await verifyAccessJwt(token, testEnv)).toBeNull();
  });

  it('rejects a token whose kid is not in the JWKS', async () => {
    const token = await mintAccessToken({ kid: 'unknown-key-id' });
    expect(await verifyAccessJwt(token, testEnv)).toBeNull();
  });

  it('rejects malformed tokens', async () => {
    expect(await verifyAccessJwt('not-a-jwt', testEnv)).toBeNull();
    expect(await verifyAccessJwt('a.b', testEnv)).toBeNull();
    expect(await verifyAccessJwt('!!!.???.***', testEnv)).toBeNull();
  });

  it('accepts aud given as an array containing our tag', async () => {
    const token = await mintAccessToken({ aud: ['another-tag', TEST_AUD] });
    expect(await verifyAccessJwt(token, testEnv)).not.toBeNull();
  });

  it('throws when the Access bindings are missing, so it cannot silently allow', async () => {
    const token = await mintAccessToken();
    await expect(
      verifyAccessJwt(token, { ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' } as unknown as Env)
    ).rejects.toThrow();
  });

  it('derives the issuer from a bare team name', async () => {
    const bare = { ACCESS_TEAM_DOMAIN: 'testteam', ACCESS_AUD: TEST_AUD } as unknown as Env;
    const token = await mintAccessToken({ iss: TEST_ISSUER });
    expect(await verifyAccessJwt(token, bare)).not.toBeNull();
  });
});

describe('readAccessToken', () => {
  it('reads the Cf-Access-Jwt-Assertion header', () => {
    const req = new Request('https://test.local/', {
      headers: { 'Cf-Access-Jwt-Assertion': 'header-token' },
    });
    expect(readAccessToken(req)).toBe('header-token');
  });

  it('falls back to the CF_Authorization cookie', () => {
    const req = new Request('https://test.local/', {
      headers: { Cookie: 'other=1; CF_Authorization=cookie-token; more=2' },
    });
    expect(readAccessToken(req)).toBe('cookie-token');
  });

  it('returns null when neither is present', () => {
    const req = new Request('https://test.local/');
    expect(readAccessToken(req)).toBeNull();
  });
});
