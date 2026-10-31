// `/auth/siwe/verify` accepts only this exact message, so the layout below is
// OpenSea's sign-in format, not a local choice. `parseSiweMessage` rejects
// anything that deviates from it before the server forwards the fields.
const DOMAIN = 'opensea.io'
const ACCOUNT_TYPE = 'Ethereum'
const STATEMENT =
  'Click to sign in and accept the Platform Terms of Service (https://opensea.io/tos) and Privacy Policy (https://opensea.io/privacy).'
const URI = 'https://opensea.io'
const VERSION = '1'

export type SiweMessage = {
  domain: string
  address: string
  statement: string
  uri: string
  version: string
  chainId: string
  nonce: string
  issuedAt: string
  accountType: string
}

export function buildSiweMessage(input: { address: string; chainId: number; nonce: string; issuedAt: string }): string {
  return [
    `${DOMAIN} wants you to sign in with your ${ACCOUNT_TYPE} account:`,
    input.address,
    '',
    STATEMENT,
    '',
    `URI: ${URI}`,
    `Version: ${VERSION}`,
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
  ].join('\n')
}

export function parseSiweMessage(message: string): SiweMessage | null {
  const lines = message.split('\n')
  if (lines.length !== 10) return null

  const [header, address, gapAfterAddress, statement, gapAfterStatement, uri, version, chainId, nonce, issuedAt] =
    lines
  if (header !== `${DOMAIN} wants you to sign in with your ${ACCOUNT_TYPE} account:`) return null
  if (address === '' || gapAfterAddress !== '' || gapAfterStatement !== '') return null
  if (statement !== STATEMENT) return null
  if (uri !== `URI: ${URI}` || version !== `Version: ${VERSION}`) return null

  const chainIdValue = valueAfter(chainId, 'Chain ID: ')
  const nonceValue = valueAfter(nonce, 'Nonce: ')
  const issuedAtValue = valueAfter(issuedAt, 'Issued At: ')
  if (chainIdValue === null || nonceValue === null || issuedAtValue === null) return null

  return {
    domain: DOMAIN,
    address,
    statement: STATEMENT,
    uri: URI,
    version: VERSION,
    chainId: chainIdValue,
    nonce: nonceValue,
    issuedAt: issuedAtValue,
    accountType: ACCOUNT_TYPE,
  }
}

function valueAfter(line: string, prefix: string): string | null {
  if (!line.startsWith(prefix)) return null
  const value = line.slice(prefix.length)
  return value === '' ? null : value
}
