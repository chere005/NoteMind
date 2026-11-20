/** Stores physical display button state for change notifications and renderer snapshots. */

import { NO_BUTTONS, sameButtons, type PenButtonsState } from "../../shared/pen"

export interface ButtonsFeed {
  get(): PenButtonsState
  /** The state is now this; listeners hear a CHANGE only. */
  set(next: PenButtonsState): void
  onChange(listener: (state: PenButtonsState) => void): () => void
}

export function createButtonsFeed(): ButtonsFeed {
  let state: PenButtonsState = { ...NO_BUTTONS }
  const listeners = new Set<(state: PenButtonsState) => void>()
  return {
    get: () => ({ ...state }),
    set(next) {
      if (sameButtons(state, next)) return
      state = { ...next }
      for (const listener of [...listeners]) { try { listener({ ...state }) } catch { /* a listener never breaks the feed */ } }
    },
    onChange(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}
