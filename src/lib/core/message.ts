// RPC endpoints can carry an API key in the path, and viem's transport errors quote the
// full URL. Anything shown to the operator or stored on a row passes through here first.
export function redactUrls(message: string): string {
  return message.replace(/https?:\/\/\S+/g, '[rpc]')
}

// The one way to turn a thrown value into copy, so redaction cannot be forgotten at a
// call site.
export function toMessage(error: unknown): string {
  return redactUrls(error instanceof Error ? error.message : String(error))
}
