// The client's error type lives on its own, with no imports, so a module that only needs
// to read a status does not pull in the API client and its transport.

export class ScatterError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ScatterError'
    this.status = status
    this.code = code
  }
}

// Callers branch on the answer, not on the exception type. 404 is a missing collection
// or list, 422 a collection Velox cannot sign for, 504 the request's deadline.
export function scatterStatus(error: unknown): number | null {
  return error instanceof ScatterError ? error.status : null
}
