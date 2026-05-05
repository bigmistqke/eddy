import type { Container, Entity } from "./types"

export function resolveNode(layout: Container, path: number[]): Entity | Container {
  let current: Entity | Container = layout
  for (let i = 0; i < path.length; i++) {
    if (current.type !== "container") {
      throw new Error("Unexpected entity node")
    }
    current = current.children[path[i]]
  }
  return current
}
