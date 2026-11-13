

import type { MenuItem } from "./FloatingMenu"
import { ZOOM_MAX, ZOOM_MIN, type FitMode } from "./pdfViewRules"

export type ViewKind = "pdf" | "image" | "docx"

export interface ViewMenuActions {
  clean(): void
  fit(mode: FitMode): void
  zoomIn(): void
  zoomOut(): void
  zoomReset(): void
  goTo(): void
  page(to: "first" | "previous" | "next" | "last"): void
  find(): void
  rotate(direction: "left" | "right"): void
  openDefault(): void
  reveal(): void
}

export interface ViewMenuInput {
  kind: ViewKind
  clean: boolean
  fit: FitMode
  zoom: number
  
  page: number
  pages: number
  
  mod: "Ctrl" | "Cmd"
  actions: ViewMenuActions
}


export function viewMenuItems({ kind, clean, fit, zoom, page, pages, mod, actions }: ViewMenuInput): MenuItem[] {
  const groups: MenuItem[][] = []
  if (kind !== "docx") {
    groups.push([
      { label: "Remove Backgrounds", checked: clean, onClick: actions.clean, dataBar: "view-clean" },
    ])
    groups.push([
      { label: "Fit Width", checked: fit === "width", onClick: () => actions.fit("width"), dataBar: "view-fit-width" },
      { label: "Fit Page", checked: fit === "page", onClick: () => actions.fit("page"), dataBar: "view-fit-page" },
    ])
    groups.push([
      { label: "Zoom In", hint: `${mod}+=`, disabled: zoom >= ZOOM_MAX, onClick: actions.zoomIn, dataBar: "view-zoom-in" },
      { label: "Zoom Out", hint: `${mod}+-`, disabled: zoom <= ZOOM_MIN, onClick: actions.zoomOut, dataBar: "view-zoom-out" },
      { label: "Reset Zoom", hint: `${mod}+0`, disabled: zoom === 1, onClick: actions.zoomReset, dataBar: "view-zoom-reset" },
    ])
  }
  if (kind === "pdf") {
    groups.push([
      { label: "Go to Page…", disabled: pages <= 1, onClick: actions.goTo, dataBar: "view-goto" },
      { label: "First Page", hint: "Home", disabled: page <= 1, onClick: () => actions.page("first"), dataBar: "view-first" },
      { label: "Previous Page", hint: "PageUp", disabled: page <= 1, onClick: () => actions.page("previous"), dataBar: "view-previous" },
      { label: "Next Page", hint: "PageDown", disabled: page >= pages, onClick: () => actions.page("next"), dataBar: "view-next" },
      { label: "Last Page", hint: "End", disabled: page >= pages, onClick: () => actions.page("last"), dataBar: "view-last" },
    ])
    groups.push([
      { label: "Find…", hint: `${mod}+F`, onClick: actions.find, dataBar: "view-find" },
    ])
  }
  if (kind === "image") {
    groups.push([
      { label: "Rotate Left", icon: "rotl", onClick: () => actions.rotate("left"), dataBar: "view-rotate-left" },
      { label: "Rotate Right", icon: "rotate", onClick: () => actions.rotate("right"), dataBar: "view-rotate-right" },
    ])
  }
  groups.push([
    { label: "Open in Default App", onClick: actions.openDefault, dataBar: "view-open" },
    { label: "Show in Folder", onClick: actions.reveal, dataBar: "view-reveal" },
  ])
  return groups.flatMap((group, at): MenuItem[] => (at === 0 ? group : ["-", ...group]))
}
