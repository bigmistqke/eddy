import { type Component, createSignal } from 'solid-js'
import { useAuth } from '~/lib/atproto/AuthContext'
import styles from './LoginButton.module.css'

const LoginButton: Component = () => {
  const auth = useAuth()
  const [handle, setHandle] = createSignal('')
  const [showInput, setShowInput] = createSignal(false)
  const [loading, setLoading] = createSignal(false)

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    const h = handle().trim()
    if (!h) return

    setLoading(true)
    try {
      await auth.signIn(h)
    } catch {
      // Error handled in context
    } finally {
      setLoading(false)
    }
  }

  return (
    <div class={styles.container}>
      {showInput() ? (
        <form onSubmit={handleSubmit} class={styles.form}>
          <input
            type="text"
            placeholder="handle.bsky.social"
            value={handle()}
            onInput={(e) => setHandle(e.currentTarget.value)}
            class={styles.input}
            disabled={loading()}
            autofocus
          />
          <button type="submit" class={styles.submit} disabled={loading()}>
            {loading() ? '...' : 'Go'}
          </button>
          <button
            type="button"
            class={styles.cancel}
            onClick={() => setShowInput(false)}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button class={styles.button} onClick={() => setShowInput(true)}>
          Sign in
        </button>
      )}
    </div>
  )
}

export default LoginButton
