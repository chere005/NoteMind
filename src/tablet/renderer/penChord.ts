/**
 * The pen's two-button chord, as the runtime (penActions.ts) hears it and the surfaces (penButtons.ts resolvePress) ask for it.
 *
 *   bottom button tapped, then the top button pressed and held, quickly: "zoom"   (the tip touching and dragging up or down zooms)
 *   top button tapped, then the bottom button pressed and held, quickly: "scroll" (the tip touching and dragging pans a zoomed page)
 *
 * The chord lasts while the second button is held (docs/PEN-BUTTONS.md).
 */
export type Chord = "zoom" | "scroll"

let current: Chord | null = null

export const activeChord = (): Chord | null => current

export function setChord(next: Chord | null): void {
  current = next
}
