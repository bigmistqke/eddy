import { type Component } from 'solid-js'
import { useParams } from '@solidjs/router'
import { Editor } from '~/components/editor/Editor'
import { ProjectProvider } from '~/lib/project/context'
import styles from './[id].module.css'

const EditorPage: Component = () => {
  const params = useParams<{ id?: string }>()

  return (
    <ProjectProvider>
      <div class={styles.container}>
        <Editor projectId={params.id} />
      </div>
    </ProjectProvider>
  )
}

export default EditorPage
