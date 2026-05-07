# Aspect-Preserved Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `Math.max`-based fit-to-target zoom with a two-stage search — aspect-preserved fit-inside (preferred) with clamp-and-overflow fallback for extreme aspect ratios. Make the target-box padding tweakable via `FRAME_PADDING` in `constants.ts`.

**Architecture:** `findFitToTargetScale` in `src/viewport.ts` becomes `findFitScale`, which first tries `min(widthFactor, heightFactor)` iteration; if that converges at ≤1, falls back to `max(...)`. `FRAME_PADDING` moves from a private const in viewport.ts to `src/constants.ts`. Three Playwright tests cover the three rules (no-zoom, fit-inside, clamp-overflow); two of them already exist.

**Tech Stack:** TypeScript, SolidJS, Playwright, pnpm.

---

## File map

- **`src/constants.ts`** — add `FRAME_PADDING` export.
- **`src/viewport.ts`** — replace `findFitToTargetScale` with `findFitInsideScale` + `findClampOverflowScale` + dispatch `findFitScale`. Use `FRAME_PADDING` from constants.
- **`tests/aspect-preserved-fit.spec.ts`** — new test for Rule 2.
- **`tests/no-zoom-when-not-needed.spec.ts`** — already exists; verify still passes.
- **`tests/handle-clears-bottom-hud.spec.ts`** — already exists; verify still passes.

---

### Task 1 — Add `FRAME_PADDING` constant

**Files:**
- Modify: `src/constants.ts`

- [ ] **Step 1: Add the constant**

In `src/constants.ts`, append after the existing `HANDLE_*` constants and before `ROOT_PADDING`:

```ts
// Per-side inset of the "target box" used by viewport zoom-to-fit. The
// selected frame is scaled (aspect-preserved) so it fits inside
// `canvas - 2*FRAME_PADDING` on each axis. Tweakable independently of
// HANDLE_H so the visual breathing room can be tuned without affecting
// handle dimensions.
export const FRAME_PADDING = 2 * HANDLE_H
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

---

### Task 2 — Write the failing test for Rule 2 (aspect-preserved fit)

**Files:**
- Create: `tests/aspect-preserved-fit.spec.ts`

- [ ] **Step 1: Write the test**

Create `tests/aspect-preserved-fit.spec.ts`:

```ts
import { expect, test } from "@playwright/test"
import { runActions } from "./helpers"

/**
 * After splitting twice horizontally then once vertically, the selected
 * frame is roughly 1/2 wide × 1/2 tall — small enough that handles
 * overlap at scale=1, but its aspect ratio is moderate enough that
 * Rule 2 (aspect-preserved fit-inside) applies. Assert:
 *   - the frame's binding axis hits the target dimension
 *   - the OTHER axis is strictly less than its target (no stretch)
 *   - the frame's aspect ratio is preserved (matches natural ratio)
 */
test("Rule 2: small frame zooms aspect-preserved (fit-inside target)", async ({ page }) => {
  await page.goto("/")

  await runActions(
    page,
    `
    [action] {"type":"set-tool","tool":"split"}
    [action] {"type":"tap-frame","path":[]}
    [action] {"type":"add-frame","path":[],"direction":"right","op":"split"}
    [action] {"type":"add-frame","path":[1],"direction":"right","op":"split"}
    [action] {"type":"add-frame","path":[1,1],"direction":"bottom","op":"split"}
    `,
  )

  const result = await page.evaluate(() => {
    const handle = document.querySelector<HTMLElement>("[data-direction='bottom']")
    const selected = handle?.closest<HTMLElement>("[data-path]")
    const canvas = document.querySelector<HTMLElement>("[data-canvas='true']")
    if (!selected || !canvas) {
      return null
    }
    const s = selected.getBoundingClientRect()
    const c = canvas.getBoundingClientRect()
    return {
      frame: { w: s.width, h: s.height },
      canvas: { w: c.width, h: c.height },
    }
  })

  expect(result).not.toBeNull()

  // FRAME_PADDING in src/constants.ts is 2 * HANDLE_H = 96. Hardcode the
  // target dims here rather than importing src code into a Playwright
  // test (Playwright loads tests outside vite — direct import would
  // require extra config).
  const FRAME_PADDING = 96
  const targetWidth = result!.canvas.w - 2 * FRAME_PADDING
  const targetHeight = result!.canvas.h - 2 * FRAME_PADDING

  // The frame must fit *inside* the target box on both axes.
  expect(result!.frame.w).toBeLessThanOrEqual(targetWidth + 1)
  expect(result!.frame.h).toBeLessThanOrEqual(targetHeight + 1)
  // At least one axis is at the target (the binding axis). Tolerance
  // accounts for sub-pixel flex math at scale.
  const widthAtTarget = Math.abs(result!.frame.w - targetWidth) < 2
  const heightAtTarget = Math.abs(result!.frame.h - targetHeight) < 2
  expect(widthAtTarget || heightAtTarget, "neither axis hit target").toBe(true)
  // The non-binding axis must be STRICTLY LESS than its target — proves
  // aspect was preserved, not stretched to fill.
  if (widthAtTarget) {
    expect(result!.frame.h).toBeLessThan(targetHeight - 1)
  } else {
    expect(result!.frame.w).toBeLessThan(targetWidth - 1)
  }
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm exec playwright test aspect-preserved-fit --reporter=list`
Expected: FAIL — currently `findFitToTargetScale` uses `Math.max`, so the non-binding axis will be **at or beyond** target, and the strict-less-than assertion fails.

---

### Task 3 — Refactor viewport.ts to use the two-stage search

**Files:**
- Modify: `src/viewport.ts`

- [ ] **Step 1: Update imports**

At the top of `src/viewport.ts`, change:

```ts
import { HANDLE_H, HANDLE_W, ROOT_PADDING, SIBLING_GAP } from "./constants"
```

to:

```ts
import { FRAME_PADDING, HANDLE_H, HANDLE_W, ROOT_PADDING, SIBLING_GAP } from "./constants"
```

- [ ] **Step 2: Replace `findFitToTargetScale` with the two-stage search**

In `src/viewport.ts`, find the comment block starting with `/** Find scale s such that the selected frame, at scale s, has its binding…` and the `findFitToTargetScale` function below it. Delete the local `const FRAME_PADDING = HANDLE_H` line. Replace the function with:

```ts
/** Iteratively scale by the LIMITING axis so the frame fits ENTIRELY
 *  inside the target box (canvas inset by FRAME_PADDING per side). The
 *  binding axis hits the target exactly; the other axis is smaller.
 *  Returns 1 if no positive growth is possible (both axes already at or
 *  beyond target on at least one dimension — caller must fall back to
 *  the clamp-overflow strategy). */
function findFitInsideScale(
  layout: Node,
  path: number[],
  canvas: { width: number; height: number },
): number {
  const targetWidth = canvas.width - 2 * FRAME_PADDING
  const targetHeight = canvas.height - 2 * FRAME_PADDING
  if (targetWidth <= 0 || targetHeight <= 0) {
    return 1
  }
  let scale = 1
  for (let iteration = 0; iteration < MAX_FIT_ITER; iteration++) {
    const rect = frameRect(layout, path, {
      width: canvas.width * scale,
      height: canvas.height * scale,
    })
    if (rect.width <= 0 || rect.height <= 0) {
      scale *= 2
      if (scale >= MAX_SCALE) {
        return MAX_SCALE
      }
      continue
    }
    const widthFactor = targetWidth / rect.width
    const heightFactor = targetHeight / rect.height
    const factor = Math.min(widthFactor, heightFactor)
    if (factor <= 1.001) {
      return scale
    }
    scale *= factor
    if (scale >= MAX_SCALE) {
      return MAX_SCALE
    }
  }
  return Math.min(scale, MAX_SCALE)
}

/** Iteratively scale by the GROWING axis so the smaller-by-ratio frame
 *  dimension fills the target box; the larger dimension overflows the
 *  canvas. Used when fit-inside can't grow the frame (one axis is
 *  already at or past target while the other is far smaller — extreme
 *  aspect ratios). Stick + extend handle the off-canvas overflow. */
function findClampOverflowScale(
  layout: Node,
  path: number[],
  canvas: { width: number; height: number },
): number {
  const targetWidth = canvas.width - 2 * FRAME_PADDING
  const targetHeight = canvas.height - 2 * FRAME_PADDING
  if (targetWidth <= 0 || targetHeight <= 0) {
    return 1
  }
  let scale = 1
  for (let iteration = 0; iteration < MAX_FIT_ITER; iteration++) {
    const rect = frameRect(layout, path, {
      width: canvas.width * scale,
      height: canvas.height * scale,
    })
    if (rect.width <= 0 || rect.height <= 0) {
      scale *= 2
      if (scale >= MAX_SCALE) {
        return MAX_SCALE
      }
      continue
    }
    const widthFactor = targetWidth / rect.width
    const heightFactor = targetHeight / rect.height
    const factor = Math.max(widthFactor, heightFactor)
    if (factor <= 1.001) {
      return scale
    }
    scale *= factor
    if (scale >= MAX_SCALE) {
      return MAX_SCALE
    }
  }
  return Math.min(scale, MAX_SCALE)
}

/** Two-stage zoom search: prefer aspect-preserved fit-inside (Rule 2);
 *  fall back to clamp-and-overflow (Rule 3) only when fit-inside can't
 *  grow the frame. */
function findFitScale(
  layout: Node,
  path: number[],
  canvas: { width: number; height: number },
): number {
  const inside = findFitInsideScale(layout, path, canvas)
  if (inside > 1.001) {
    return inside
  }
  return findClampOverflowScale(layout, path, canvas)
}
```

- [ ] **Step 3: Update the call site**

In `src/viewport.ts`, inside `computeViewportTransform`, find:

```ts
  const fitScale = findFitToTargetScale(layout, path, canvas)
```

Change to:

```ts
  const fitScale = findFitScale(layout, path, canvas)
```

- [ ] **Step 4: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

---

### Task 4 — Run the new test, verify it passes

- [ ] **Step 1: Run the targeted test**

Run: `pnpm exec playwright test aspect-preserved-fit --reporter=list`
Expected: PASS — frame is fit-inside the target, binding axis at target, other axis strictly smaller.

---

### Task 5 — Run the full suite, verify no regressions

- [ ] **Step 1: Run all tests**

Run: `pnpm test`
Expected: 12 passed (existing 11 + new aspect-preserved-fit).

If any of the existing tests fail, investigate before continuing. Notable ones to watch:
- `no-zoom-when-not-needed` — Rule 1 (identity) must still trigger after one split-right.
- `handle-clears-bottom-hud` — Rule 3 (clamp-overflow) must still trigger after four right-splits.
- `centered-deep-frame`, `very-deep-frame` — alternating right/top splits should still center and not break handle clicks.

---

### Task 6 — Commit

- [ ] **Step 1: Stage and commit**

```bash
git add src/constants.ts src/viewport.ts tests/aspect-preserved-fit.spec.ts
git commit -m "feat: aspect-preserved zoom-to-fit; clamp-overflow fallback

Replace Math.max-based fit-to-target with a two-stage search: prefer
aspect-preserved fit-inside (the frame fits entirely inside the target
box, one axis hits target, the other is smaller); fall back to
max-based clamp-and-overflow only when fit-inside cannot grow the
frame (extreme aspect ratios).

FRAME_PADDING moves to constants.ts so the visual breathing room can
be tuned independently of HANDLE_H."
```

- [ ] **Step 2: Verify clean tree**

Run: `git status`
Expected: working tree clean (or only unrelated changes).
