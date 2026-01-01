import {
  type ParentComponent,
  createContext,
  useContext,
  createSignal,
  onMount,
} from 'solid-js'
import { Agent } from '@atproto/api'
import type { OAuthSession } from '@atproto/oauth-client-browser'
import { initSession, signIn as doSignIn, createAgent } from './client'

interface AuthContextValue {
  session: () => OAuthSession | null
  agent: () => Agent | null
  loading: () => boolean
  error: () => string | null
  signIn: (handle: string) => Promise<void>
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue>()

export const AuthProvider: ParentComponent = (props) => {
  const [session, setSession] = createSignal<OAuthSession | null>(null)
  const [agent, setAgent] = createSignal<Agent | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  onMount(async () => {
    try {
      const existingSession = await initSession()
      if (existingSession) {
        setSession(existingSession)
        setAgent(createAgent(existingSession))
      }
    } catch (err) {
      console.error('Failed to restore session:', err)
      setError(err instanceof Error ? err.message : 'Failed to restore session')
    } finally {
      setLoading(false)
    }
  })

  const signIn = async (handle: string) => {
    setError(null)
    try {
      await doSignIn(handle)
    } catch (err) {
      console.error('Sign in failed:', err)
      setError(err instanceof Error ? err.message : 'Sign in failed')
      throw err
    }
  }

  const signOut = () => {
    setSession(null)
    setAgent(null)
  }

  return (
    <AuthContext.Provider
      value={{ session, agent, loading, error, signIn, signOut }}
    >
      {props.children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
