import path from 'node:path';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));

  return {
    test: {
      name: 'worker',
      include: ['worker/test/**/*.test.ts'],
      setupFiles: ['./worker/test/apply-migrations.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.test.toml' },
          miniflare: {
            bindings: {
              ALLOW_TEST_AUTH: 'true',
              LINE_CHANNEL_ACCESS_TOKEN: 'test-access-token',
              LINE_CHANNEL_SECRET: 'test-channel-secret',
              LINE_CHANNEL_ID: 'test-channel-id',
              LIFF_ID: 'test-liff-id',
              LIFF_URL: 'https://liff.line.me/test-liff-id',
              LIFF_CONTEXT_SIGNING_SECRET: 'test-liff-context-signing-secret',
              APP_TIMEZONE: 'Asia/Taipei',
              TEST_MIGRATIONS: migrations,
            },
          },
        },
      },
    },
  };
});
