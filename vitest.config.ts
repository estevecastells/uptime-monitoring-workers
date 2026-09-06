import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          d1Databases: ['DB'],
          // Access config for tests. These must match the values the test
          // helpers in src/__tests__/access-helpers.ts sign tokens with, and
          // deliberately differ from any real deployment.
          bindings: {
            ACCESS_TEAM_DOMAIN: 'testteam.cloudflareaccess.com',
            ACCESS_AUD: 'test-access-aud-tag',
          },
        },
      },
    },
  },
});
