// The client's error type, with the status and code a caller may name. It has no
// imports, so a module that only needs to throw it stays off the API client.

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
