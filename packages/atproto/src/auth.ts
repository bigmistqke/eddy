import { Agent } from '@atproto/api'
import { BrowserOAuthClient, type OAuthSession } from '@atproto/oauth-client-browser'

let oauthClient: BrowserOAuthClient | null = null

export async function getOAuthClient(): Promise<BrowserOAuthClient> {
  if (oauthClient) return oauthClient

  // For loopback development:
  // - clientId must be http://localhost (no port)
  // - redirect_uri specified via query string with the actual port
  // - App must be accessed via http://127.0.0.1:<port>
  const port = window.location.port || '5173'
  const redirectUri = `http://127.0.0.1:${port}/callback`
  const scope = 'atproto transition:generic'
  const clientId = `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`

  oauthClient = await BrowserOAuthClient.load({
    clientId,
    handleResolver: 'https://bsky.social',
  })

  return oauthClient
}

export function makeAgent(session: OAuthSession): Agent {
  return new Agent(session)
}

export async function initSession(): Promise<OAuthSession | null> {
  const client = await getOAuthClient()
  const result = await client.init()
  return result?.session ?? null
}

export async function signIn(handle: string): Promise<void> {
  const client = await getOAuthClient()
  await client.signIn(handle, {
    scope: 'atproto transition:generic',
  })
}
