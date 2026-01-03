import { type Component, Show } from 'solid-js'
import { A } from '@solidjs/router'
import { useAuth } from '~/lib/atproto/AuthContext'
import { LoginButton } from '~/components/auth/LoginButton'
import { UserMenu } from '~/components/auth/UserMenu'
import styles from './Header.module.css'

export const Header: Component = () => {
  const auth = useAuth()

  return (
    <header class={styles.header}>
      <A href="/" class={styles.logo}>
        Klip
      </A>
      <div class={styles.actions}>
        <Show when={!auth.loading()} fallback={<span class={styles.loading}>...</span>}>
          <Show when={auth.session()} fallback={<LoginButton />}>
            <UserMenu />
          </Show>
        </Show>
      </div>
    </header>
  )
}

