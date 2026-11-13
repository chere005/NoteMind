/**
 * main/pen/buttonsFeed.ts - what a PEN DISPLAY's own side buttons are now (shared/pen.ts PenButtonsState), kept in one place.
 *
 * The source is `wm-pen --buttons` (macPenBackend.ts MacPenButtons), or - under NOTEMIND_E2E, which never opens the real helper -
 * the test hook (ipc.ts `pen:e2e-buttons`). The readers are the pen IPC, which pushes every change to the window in front, and
 * answers a window that asks (it has just come to the front, or has just loaded). No Electron: the whole file is a vitest.
 */

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
