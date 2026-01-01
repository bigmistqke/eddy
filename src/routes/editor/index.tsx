import { type Component } from 'solid-js'
import { useParams } from '@solidjs/router'
import { Editor } from '~/components/editor/Editor'
import { ProjectProvider } from '~/lib/project/context'
import styles from './index.module.css'

const EditorPage: Component = () => {
  const params = useParams<{ handle?: string; rkey?: string }>()

  return (
    <ProjectProvider>
      <div class={styles.container}>
        <Editor handle={params.handle} rkey={params.rkey} />
      </div>
    </ProjectProvider>
  )
}

export default EditorPage
