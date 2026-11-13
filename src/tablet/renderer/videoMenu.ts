

const TABLET_SOURCE="tablet";const shown=(id:string,_platform:string)=>id==="toggleCamera"?"Ctrl+Shift+Y":"Ctrl+Alt+R"
import { ORIENTATIONS, type Orientation } from "../shared/orientation"
import type { MenuItem } from "./FloatingMenu"

export interface VideoMenuState {
  platform: string
  
  camera: boolean
  cameras: { id: string; name: string }[]
  
  cameraId: string | null
  
  notesPane: boolean
  
  orientation: Orientation
}

export interface VideoMenuActions {
  toggleVideo(): void
  pick(id: string): void
  off(): void
  refresh(): void
  
  turn(direction: "turn-left" | "turn-right"): void
  
  orient(value: Orientation): void
  toggleNotesPane(): void
}

export function videoMenu(state: VideoMenuState, act: VideoMenuActions): MenuItem[] {
  const { platform, camera, cameras, cameraId, notesPane, orientation } = state
  // A camera can be turned; the tablet's sheet is not a picture, and with nothing open there is nothing to turn.
  const turnable = cameraId !== null && cameraId !== TABLET_SOURCE
  const sources: MenuItem[] = cameras.length === 0
    ? [{ label: "No cameras found", disabled: true }]
    : cameras.map((one): MenuItem => ({
      label: one.name, icon: "camera", checked: cameraId === one.id, onClick: () => act.pick(one.id), dataBar: "video-source",
    }))
  return [
    { label: "Show video", checked: camera, hint: shown("toggleCamera", platform), onClick: act.toggleVideo, dataBar: "video-show" },
    "-",
    ...sources,
    { label: "Tablet sheet", icon: "tablet", checked: cameraId === TABLET_SOURCE, onClick: () => act.pick(TABLET_SOURCE), dataBar: "video-tablet" },
    { label: "Turn camera off", disabled: cameraId === null, onClick: act.off, dataBar: "video-off" },
    "-",
    { label: "Turn left", keepOpen: true, disabled: !turnable, onClick: () => act.turn("turn-left"), dataBar: "video-turn-left" },
    { label: "Turn right", keepOpen: true, disabled: !turnable, onClick: () => act.turn("turn-right"), dataBar: "video-turn-right" },
    // (Never greyed: the tablet is turned on the desk whatever the pane shows. A pick closes the menu, as the header's OrientationMenu does.)
    {
      label: "Tablet orientation", dataBar: "video-orientation",
      submenu: ORIENTATIONS.map((one): MenuItem => ({
        label: one.label, checked: one.value === orientation, onClick: () => act.orient(one.value), dataBar: `video-orientation-${one.value}`,
      })),
    },
    { label: "Refresh devices", keepOpen: true, hint: shown("cameraRefresh", platform), onClick: act.refresh, dataBar: "video-refresh" },
    "-",
    {
      label: notesPane ? "Video Only (Hide Document Pane)" : "Back to Side by Side", disabled: !camera,
      onClick: act.toggleNotesPane, dataBar: "video-only",
    },
  ]
}
