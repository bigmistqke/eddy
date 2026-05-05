import { createSignal, createStore, Show } from "solid-js"
import styles from "./app.module.css"
import { Context } from "./context"
import { Notch } from "./frame"
import { CloseIcon, PlayIcon, PlusIcon, RecordIcon, SplitIcon } from "./icons"
import { LayoutBuilder } from "./layout-builder"
import { NodeComponent } from "./node-component"
import type { AppState, Container, Direction, Entity, Node } from "./types"
import { resolveNode } from "./utils"

function cloneNode(node: Node): Node {
  if (node.type === "entity") return { ...node }
  return { type: "container", direction: node.direction, children: node.children.map(cloneNode) }
}

function createEntity(): Entity {
  return {
    type: "entity",
    color: `rgb(${Math.random() * 100 + 150}, ${Math.random() * 100 + 150}, ${Math.random() * 100 + 150})`,
  }
}

export function App() {
  const [layout, setLayout] = createStore<Container>({
    type: "container",
    direction: "horizontal",
    children: [createEntity()],
  })

  const [selection, setSelection] = createStore({ path: [0] as Array<number>, depth: 0 })
  const [appState, setAppState] = createStore<AppState>({ view: { type: "recording" } })
  const [bottomBarEl, setBottomBarEl] = createSignal<HTMLElement | undefined>()

  function appendToContainer(containerPath: number[], insertIndex: number) {
    const newEntity = createEntity()
    setLayout(proxy => {
      const container = resolveNode(proxy, containerPath) as Container
      container.children.splice(insertIndex, 0, newEntity)
    })
    setSelection(() => ({ path: [...containerPath, insertIndex], depth: 1 }))
  }

  function splitNode(nodePath: number[], direction: Direction) {
    const splitDir: "horizontal" | "vertical" =
      direction === "left" || direction === "right" ? "horizontal" : "vertical"
    const newEntityFirst = direction === "top" || direction === "left"
    const newEntityIndex = newEntityFirst ? 0 : 1
    const newEntity = createEntity()

    if (nodePath.length === 0) {
      const inner: Container = {
        type: "container",
        direction: layout.direction,
        children: layout.children.map(cloneNode) as (Entity | Container)[],
      }
      setLayout(proxy => {
        proxy.direction = splitDir
        proxy.children.splice(
          0,
          proxy.children.length,
          ...(newEntityFirst ? [newEntity, inner] : [inner, newEntity]),
        )
      })
      setSelection(() => ({ path: [newEntityIndex], depth: 0 }))
      return
    }

    const parentPath = nodePath.slice(0, -1)
    const nodeIndex = nodePath[nodePath.length - 1]
    const parent = resolveNode(layout, parentPath) as Container

    if (parent.children.length === 1) {
      setLayout(proxy => {
        const p = resolveNode(proxy, parentPath) as Container
        p.direction = splitDir
        p.children.splice(newEntityFirst ? 0 : 1, 0, newEntity)
      })
      setSelection(() => ({ path: [...parentPath, newEntityIndex], depth: 0 }))
      return
    }

    const node = resolveNode(layout, nodePath)
    const newContainer: Container = {
      type: "container",
      direction: splitDir,
      children: newEntityFirst ? [newEntity, cloneNode(node)] : [cloneNode(node), newEntity],
    }
    setLayout(proxy => {
      const p = resolveNode(proxy, parentPath) as Container
      p.children.splice(nodeIndex, 1, newContainer)
    })
    setSelection(() => ({ path: [...nodePath, newEntityIndex], depth: 0 }))
  }

  function handleAppend(path: number[], direction: Direction) {
    const containerPath = path.slice(0, -1)
    const childIndex = path[path.length - 1]
    const insertAfter = direction === "right" || direction === "bottom"
    appendToContainer(containerPath, insertAfter ? childIndex + 1 : childIndex)
  }

  function enterAppendMode() {
    setAppState(() => ({ view: { type: "layout", mode: "append" } }))
    if (selection.depth === 0) setSelection(s => ({ ...s, depth: 1 }))
  }

  const layoutView = () =>
    appState.view.type === "layout"
      ? (appState.view as { type: "layout"; mode: "append" | "split" })
      : null

  return (
    <Context
      value={{
        layout,
        selection,
        setSelection,
        appState,
        setAppState,
        bottomBarEl,
        setBottomBarEl,
      }}
    >
      <div style={{ display: "flex", width: "100vw", height: "100%", position: "relative" }}>
        <Show when={appState.view.type === "recording"}>
          <div class={styles.recordingView}>
            <NodeComponent layout={layout} path={[]} onAppend={handleAppend} onSplit={splitNode} />
          </div>
        </Show>
        <Show when={appState.view.type === "layout"}>
          <LayoutBuilder>
            <NodeComponent layout={layout} path={[]} onAppend={handleAppend} onSplit={splitNode} />
          </LayoutBuilder>
        </Show>
        <Notch ref={el => setBottomBarEl(el)} class={styles.bottomBar}>
          <div class={styles.bottomBarContent}>
            <Show
              when={appState.view.type === "recording"}
              fallback={
                <>
                  <button
                    class={[styles.modeButton, layoutView()?.mode === "append" ? styles.active : ""]}
                    onClick={() => enterAppendMode()}
                  >
                    <PlusIcon />
                  </button>
                  <button
                    class={[styles.modeButton, layoutView()?.mode === "split" ? styles.active : ""]}
                    onClick={() => setAppState(() => ({ view: { type: "layout", mode: "split" } }))}
                  >
                    <SplitIcon />
                  </button>
                  <button
                    class={styles.closeButton}
                    onClick={() => setAppState(() => ({ view: { type: "recording" } }))}
                  >
                    <CloseIcon />
                  </button>
                </>
              }
            >
              <button class={styles.barButton} onClick={() => enterAppendMode()}>
                <PlusIcon />
              </button>
              <button class={styles.barButton}>
                <RecordIcon />
              </button>
              <button class={styles.barButton}>
                <PlayIcon />
              </button>
            </Show>
          </div>
        </Notch>
      </div>
    </Context>
  )
}
