import type { StoreSetter } from "@solidjs/signals"
import type { Accessor } from "solid-js"

export type Container = {
  type: "container"
  direction: "horizontal" | "vertical"
  children: Array<Entity | Container>
}
export type Entity = { type: "entity"; color: string }
export type Node = Container | Entity

export type AppView = { type: "recording" } | { type: "layout"; mode: "append" | "split" }
export type AppState = { view: AppView }

export type Direction = "top" | "bottom" | "left" | "right"
export type Selection = { path: Array<number>; depth: number }

export type AppContext = {
  layout: Container
  selection: Selection
  setSelection: StoreSetter<Selection>
  appState: AppState
  setAppState: StoreSetter<AppState>
  bottomBarEl: Accessor<HTMLElement | undefined>
  setBottomBarEl: (el: HTMLElement | undefined) => void
}
