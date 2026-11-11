// The client's error type lives on its own, with no imports, so a module that only needs
// to read a status does not pull in the API client, its transport and Seaport.

export class OpenSeaError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'OpenSeaError'
    this.status = status
    this.code = code
  }
}

// Callers branch on the answer, not on the exception type. 0 means no API key was set,
// 401 a rejected key, 403 a revoked token, 404 a missing resource.
export function openSeaStatus(error: unknown): number | null {
  return error instanceof OpenSeaError ? error.status : null
}
