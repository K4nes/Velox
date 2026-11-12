import { existsSync } from 'node:fs'

if (existsSync('.env.e2e.local')) {
  process.loadEnvFile('.env.e2e.local')
}

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(
      `Missing ${name}; put it in .env.e2e.local at the repo root, which is git-ignored`
    )
  }
  return value
}
