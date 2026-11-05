export { cn } from "cn"

// RPC endpoints can carry an API key in the path, and viem's transport errors
// quote the full URL. Anything shown to the operator or stored on a row goes
// through here first.
export function redactUrls(message: string): string {
  return message.replace(/https?:\/\/\S+/g, '[rpc]')
}
