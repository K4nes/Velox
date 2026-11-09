import type { E2EConfig } from 'e2e'
import { web } from '@e2e-dev/web'

export default {
  projectId: 'velox',
  tests: ['tests/**/*.e2e.ts', '!tests/live/**'],
  reporters: ['list', 'junit'],
  timeout: 120_000,
  actionTimeout: 30_000,
  assertionTimeout: 10_000,
  trace: 'retain-on-failure',
  output: '.e2e',
  targets: [
    {
      name: 'velox',
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
