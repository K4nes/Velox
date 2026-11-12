import { readFileSync } from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { apiPlugin } from './server/plugin.ts'

// The sidebar, the installer and the window title all report this one number.
function readVersion(): string {
  const source = readFileSync(
    path.resolve(import.meta.dirname, 'package.json'),
    'utf8'
  )
  try {
    return (JSON.parse(source) as { version: string }).version
  } catch {
    throw new Error('package.json is not valid JSON')
  }
}

const version = readVersion()

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [react(), tailwindcss(), apiPlugin({ cmcApiKey: env.CMC_API_KEY })],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
  }
})
