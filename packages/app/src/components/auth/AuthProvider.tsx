import { initSession, makeAgent, signIn } from '@eddy/atproto'
import { action, createAsync, query } from '@solidjs/router'
import { createMemo, createSignal, type ParentComponent } from 'solid-js'
import { AuthContext } from '~/contexts/auth-context'

const getSession = query(async () => {
  const session = await initSession()
  return session
}, 'session')

export const signInAction = action(async (handle: string) => {
  await signIn(handle)
  return { ok: true }
})

export const AuthProvider: ParentComponent = props => {
  const session = createAsync(() => getSession())
  const [manualSignOut, setManualSignOut] = createSignal(false)

  const activeSession = createMemo(() => {
    if (manualSignOut()) return null
    return session()
  })

  const agent = createMemo(() => {
    const _activeSession = activeSession()
    return _activeSession ? makeAgent(_activeSession) : null
  })

  const loading = () => session() === undefined && !manualSignOut()

  const signOut = () => {
    setManualSignOut(true)
  }

  return (
    <AuthContext.Provider value={{ session: activeSession, agent, loading, signOut }}>
      {props.children}
    </AuthContext.Provider>
  )
}
