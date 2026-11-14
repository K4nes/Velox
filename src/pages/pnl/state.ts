// Type imports only: `npm run test:release` loads this file with node type stripping.

export type PnlMonthlyState = {
  month: Date
  selectedDay: Date | undefined
  query: string
  sort: string
}

export type PnlLifetimeState = {
  query: string
  sort: string
}

export function createPnlMonthlyState(): PnlMonthlyState {
  const now = new Date()
  return {
    month: new Date(now.getFullYear(), now.getMonth(), 1),
    selectedDay: undefined,
    query: '',
    sort: 'Newest First',
  }
}

export function createPnlLifetimeState(): PnlLifetimeState {
  return { query: '', sort: 'Newest First' }
}
