import { type ParentComponent, Suspense } from 'solid-js'
import { AuthProvider } from '~/lib/atproto/AuthContext'
import { Header } from '~/components/layout/Header'
import styles from './App.module.css'

export const App: ParentComponent = (props) => {
  return (
    <AuthProvider>
      <div class={styles.app}>
        <Header />
        <main class={styles.main}>
          <Suspense fallback={<div class={styles.loading}>Loading...</div>}>
            {props.children}
          </Suspense>
        </main>
      </div>
    </AuthProvider>
  )
}

