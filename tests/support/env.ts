import { existsSync } from 'node:fs'

if (existsSync('.env.e2e.local')) {
  process.loadEnvFile('.env.e2e.local')
}

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`Missing ${name}; see docs/e2e-setup-plan.md section 5`)
  }
  return value
}
