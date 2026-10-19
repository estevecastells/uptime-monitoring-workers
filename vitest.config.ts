import { existsSync } from 'node:fs';
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

// wrangler.toml is gitignored; fresh clones (and cloud agents) test against the example.
const configPath = existsSync('./wrangler.toml') ? './wrangler.toml' : './wrangler.test.toml';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath },
        miniflare: {
          d1Databases: ['DB'],
          // Access config for tests. These must match the values the test
          // helpers in src/__tests__/access-helpers.ts sign tokens with, and
          // deliberately differ from any real deployment.
          bindings: {
            ACCESS_TEAM_DOMAIN: 'testteam.cloudflareaccess.com',
            ACCESS_AUD: 'test-access-aud-tag',
            // Zone discovery is skipped without credentials; tests mock the API.
            CLOUDFLARE_API_KEY: 'test-api-key',
            CLOUDFLARE_EMAIL: 'test@example.com',
          },
        },
      },
    },
  },
});
