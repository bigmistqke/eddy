import type { Agent, OAuthSession } from '@eddy/atproto'
import { createContext, useContext, type Accessor } from 'solid-js'

interface AuthContextValue {
  session: Accessor<OAuthSession | null | undefined>
  agent: Accessor<Agent | null>
  loading: Accessor<boolean>
  signOut: Accessor<void>
}

export const AuthContext = createContext<AuthContextValue>()

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
