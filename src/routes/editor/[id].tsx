import { type Component } from 'solid-js'
import { useParams } from '@solidjs/router'
import { Editor } from '~/components/editor/Editor'
import styles from './[id].module.css'

const EditorPage: Component = () => {
  const params = useParams<{ id?: string }>()

  return (
    <div class={styles.container}>
      <Editor projectId={params.id} />
    </div>
  )
}

export default EditorPage
