/** The mounted drawing surface can handle Undo and Redo before the general Drawing commands. */
type Handler = (which: "undo" | "redo", byPen: boolean) => boolean

let handler: Handler | null = null

export const setTabletUndo = (next: Handler | null): void => { handler = next }
export const tabletUndo = (which: "undo" | "redo", byPen = false): boolean => handler?.(which, byPen) ?? false
