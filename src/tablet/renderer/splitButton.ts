/**
 * The shapes of a bar button that can open a menu, and the names its parts answer to (MenuButton.tsx draws them; this is the
 * part that is a rule and not a picture, so a test can hold it).
 *
 *   MENU    no job of its own: the whole button opens the menu (Style, Shapes, More, the open-notes list)
 *   SPLIT   a job of its own AND a menu: the main button does the job and a separate ▾ segment beside it opens the menu,
 *           the two one rounded shape [XX|▾] (Sean, 2026-10-18: "the buttons that have dropdowns to pick a default.. its
 *           hard to press the corner.. can we make the button one of those like [XX|^] where ^ is actually the down
 *           arrow style buttons?"). The corner triangle that used to mark a split was twelve pixels of a 28px button.
 */

export type MenuShape = "menu" | "split"

/** A button with a click of its own is a split; one without opens its menu when clicked. */
export const shapeOf = (onMain: unknown): MenuShape => (onMain ? "split" : "menu")

/**
 * The width of the ▾ segment, in px. "Comfortable" is the point of it: the corner it replaces was 12px square. The bar's fold
 * arithmetic (barFold.ts, cameraHeaderFit.ts) and bars.css (`.bar-split > .bar-btn.caret`) both read this one number.
 */
export const CARET_WIDTH = 24

/**
 * Where a menu's left edge goes. A SPLIT's menu hangs under the whole shape and is right-aligned with it (the pen's, at the end of
 * its bar: `right`, `x` the shape's right edge); when it is too wide to hang that way from a button near the left of the window
 * (it would start left of the window, over the sidebar), it hangs from the shape's own left edge instead (`leftX`). Either way it is
 * kept inside the window, `margin` from its edges. Every other menu is `x` and no more.
 */
export function menuLeft(width: number, x: number, right: boolean, leftX: number | undefined, viewport: number, margin = 4): number {
  const wanted = right ? (x - width >= margin ? x - width : leftX ?? x - width) : x
  return Math.max(margin, Math.min(wanted, viewport - width - margin))
}

/**
 * A tooltip's first line, without the key in brackets after the name: "List  (⌘⇧L)\nMake these lines a list" is "List". The
 * name a button answers to when the page did not give it one (a tooltip is a sentence, not a name).
 */
export function nameOfTitle(title: string): string {
  const first = title.split("\n")[0] ?? ""
  return first.replace(/\s+\([^)]*\)\s*$/, "").trim()
}

/** The ▾ segment's accessible name: "<the button's name> options" (a screen reader says "List options", "Pen options"). */
export function optionsName(name: string | undefined, title: string): string {
  const base = (name ?? nameOfTitle(title)).trim()
  return `${base} options`
}

/**
 * The ▾ segment's test hook (`data-bar`), when the page did not give one: the main button's `data-bar` and "-menu" (the pen's
 * is `pen` and `pen-menu`). The main button keeps its own hook untouched, so a test that finds the button by it still does.
 */
export const caretBarFor = (dataBar: string | undefined, explicit: string | undefined): string | undefined =>
  explicit ?? (dataBar ? `${dataBar}-menu` : undefined)
