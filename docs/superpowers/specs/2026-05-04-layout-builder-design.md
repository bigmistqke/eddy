# Layout Builder — Interaction Design

**Project:** Eddy — mobile camera compositing app
**Date:** 2026-05-04
**Status:** Approved

## Context

Eddy is a mobile-first app for creating music by compositing multiple camera layers. Inspired by TikTok duet and early YouTube creative editing. The layout builder is the surface where users arrange camera frames spatially before/during recording.

## Goals

- Simple layouts (2–4 frames) must be achievable in a few taps
- Power users can build complex nested grids if they want to
- No ambiguity about what an action will do before you do it

## Data Model

An n-ary tree:

```
Container { direction: "horizontal" | "vertical", children: (Frame | Container)[] }
Frame      { ...camera/entity data }
```

- `Frame` is always a leaf node
- `Container` holds 1+ children in a single direction
- The root is always a Container

No changes to the existing data model are needed.

## Selection Model

Selection is a **path** — an array of indices from the root to the currently targeted node. Example: `[0, 1]` means `root.children[0].children[1]`.

- Tapping a Frame sets the path to that frame's full path
- Tapping a breadcrumb ancestor **truncates** the path to that level — this is how the user targets a higher container for Append
- The selected path determines both what is visually highlighted and what Append/Split operate on

## Two Modes

A persistent mode toggle is visible whenever any frame is selected. Default is **Append**.

### Append mode

Adds a new Frame as a sibling inside the **currently targeted container** (the container at the selected path, or its parent if the leaf frame is targeted).

- Shows `+` handles only on the axis of the targeted container's direction:
  - Horizontal container → left and right handles only
  - Vertical container → top and bottom handles only
- Tapping a handle inserts a new Frame at that position in the container's `children` array
- The new Frame becomes selected after insertion
- Breadcrumb is the mechanism for targeting a higher-level container

### Split mode

Wraps the **currently targeted node** (Frame or Container) in a new sub-Container.

- The breadcrumb determines what gets split — the targeted node can be a leaf Frame or any ancestor Container
- Shows `÷` handles in all 4 directions on the targeted node
- Tapping a handle:
  1. Creates a new Container with the direction implied by the chosen handle
  2. Places the original node and a new Frame as its two children (new frame on the side of the tapped handle)
  3. Substitutes the new Container in place of the original node in the tree
- The new Frame becomes selected after the split

## Breadcrumb

- Rendered below the canvas whenever a frame is selected
- Derived from the current selection path: each ancestor container is a tappable segment
- Tapping a segment truncates selection to that level — this becomes the target for both Append (which container to add into) and Split (which node to wrap)
- Example path display: `root › row › col › [frame A]`

## What Is Deferred

- **Resize** — frames share equal space in their container for now; dragging a divider to resize proportions is a later feature
- **Drag to reorder / nest** — reordering frames within a container and drag-based nesting are deferred

## Key Rules Summary

| | Append | Split |
|---|---|---|
| Operates on | Targeted container (via breadcrumb) | Targeted node — Frame or Container (via breadcrumb) |
| Handles shown | 2 — on parent container's axis only | 4 — all directions |
| Effect | Inserts new Frame as sibling | Wraps targeted node in new sub-Container |
| Breadcrumb affects it | Yes — targets which container | Yes — targets which node to split |
| New frame selected after | Yes | Yes |
