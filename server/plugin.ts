import type { IncomingHttpHeaders, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'
import { AUTH_PATHS, handleAuth } from './auth.ts'
import { PRICE_PATHS, handlePrice } from './price.ts'

const MAX_BODY_BYTES = 1 << 20
const API_PATHS: readonly string[] = [...AUTH_PATHS, ...PRICE_PATHS]

export function apiPlugin({ cmcApiKey }: { cmcApiKey: string | undefined }): Plugin {
  return {
    name: 'velox-api',
    configureServer(server) {
      server.middlewares.use(middleware(cmcApiKey))
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(cmcApiKey))
    },
  }
}

function middleware(cmcApiKey: string | undefined) {
  return async (req: Connect.IncomingMessage, res: ServerResponse, next: Connect.NextFunction): Promise<void> => {
    let pathname: string
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    } catch {
      writeJson(res, 400, { error: 'bad request' })
      return
    }

    if (!API_PATHS.includes(pathname)) {
      next()
      return
    }

    if (!isLocalOrigin(req.headers.origin)) {
      writeJson(res, 403, { error: 'origin not allowed' })
      return
    }

    try {
      const body = await readBody(req)
      const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, {
        method: req.method,
        headers: toHeaders(req.headers),
        body: body.length === 0 ? undefined : body,
      })
      const response = PRICE_PATHS.includes(pathname)
        ? await handlePrice(request, cmcApiKey ?? '')
        : await handleAuth(request)
      await writeResponse(res, response)
    } catch (failure) {
      if (res.headersSent) return
      if (failure instanceof BodyTooLargeError) {
        writeJson(res, 413, { error: 'request body too large' })
        return
      }
      writeJson(res, 500, { error: 'api proxy failed' })
    }
  }
}

function isLocalOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true
  try {
    const { hostname } = new URL(origin)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}

class BodyTooLargeError extends Error {}

async function readBody(req: Connect.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  let tooLarge = false
  // Draining to the end keeps the connection reusable; throwing mid-stream
  // tears the socket down and loses whatever was queued behind it.
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      tooLarge = true
      chunks.length = 0
      continue
    }
    if (!tooLarge) chunks.push(buffer)
  }
  if (tooLarge) throw new BodyTooLargeError()
  return Buffer.concat(chunks)
}

function toHeaders(source: IncomingHttpHeaders): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }
  return headers
}

async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  const body = Buffer.from(await response.arrayBuffer())
  const headers: Record<string, string | number> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  headers['content-length'] = body.length
  res.writeHead(response.status, headers)
  res.end(body)
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}
