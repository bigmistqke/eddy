import { createContext, useContext, type ParentComponent } from 'solid-js'
import { createProjectStore, type ProjectStoreActions } from './store'

const ProjectContext = createContext<ProjectStoreActions>()

export const ProjectProvider: ParentComponent = (props) => {
  const projectStore = createProjectStore()

  return (
    <ProjectContext.Provider value={projectStore}>
      {props.children}
    </ProjectContext.Provider>
  )
}

export function useProject(): ProjectStoreActions {
  const context = useContext(ProjectContext)
  if (!context) {
    throw new Error('useProject must be used within a ProjectProvider')
  }
  return context
}
