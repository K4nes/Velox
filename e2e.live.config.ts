import type { E2EConfig } from 'e2e'
import { web } from '@e2e-dev/web'

export default {
  projectId: 'velox-live',
  tests: 'tests/**/live/**/*.e2e.ts',
  reporters: ['list', 'junit'],
  retries: 0,
  workers: 1,
  timeout: 2_700_000,
  actionTimeout: 60_000,
  assertionTimeout: 15_000,
  trace: 'off',
  video: 'off',
  output: '.e2e-live',
  targets: [
    {
      name: 'live',
      engine: web({ viewport: { width: 1440, height: 900 } }),
      app: {
        url: 'http://127.0.0.1:0',
        command: {
          executable: 'node',
          args: [
            'node_modules/vite/bin/vite.js',
            '--host',
            '127.0.0.1',
            '--port',
            '{port}',
            '--strictPort',
          ],
        },
      },
    },
  ],
} satisfies E2EConfig
