# eddy

A layout builder built with [Solid 2.x](https://github.com/solidjs/solid).

## What it does

Eddy lets you compose a panel layout by splitting and appending frames. Each frame holds an entity (a colored panel). Layouts can be split horizontally or vertically, and new panels can be appended to any edge.

Two views:

- **Recording** — the normal working view
- **Layout** — edit mode with two sub-modes:
  - **Append** — add new panels to edges of the selected container
  - **Split** — divide the selected panel in any direction

## Development

```bash
npm install
npm run dev
```

## Type check

```bash
npm run typecheck
```

## Stack

- [Solid 2.x](https://github.com/solidjs/solid) — `solid-js`, `@solidjs/signals`, `@solidjs/web`
- [Vite](https://vitejs.dev/)
- TypeScript
