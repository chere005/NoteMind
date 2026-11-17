/**
 * The tablet's orientation, remembered (the Mac keeps `cameraRotation` the same
 * way: a quarter-turn setting in the defaults). The arithmetic is
 * shared/orientation.ts; this is the stored choice and a hook to read it.
 *
 * ONE setting for the Tablet sheet's header, the Pen settings, the video button's menu and Input Devices ▸ Tablet Orientation. Every open
 * window of the app reads it from the same storage, so a choice made in one project window turns the pen in the others too.
 */

import { useSyncExternalStore } from "react"
import { parseOrientation, turnsOf, type Orientation, type Turns } from "../shared/orientation"

export const ORIENTATION_KEY = "notemind.orientation"

function load(): Orientation {
  try { return parseOrientation(localStorage.getItem(ORIENTATION_KEY)) } catch { return 0 }
}

let current: Orientation = load()
let orientationVersion = 0
const listeners = new Set<() => void>()

export const orientation = (): Orientation => current
export const currentTurns = (): Turns => turnsOf(current)

function publish(next: Orientation): void {
  orientationVersion++
  if (next === current) return
  current = next
  listeners.forEach((listener) => listener())
}

export function setOrientation(next: Orientation): void {
  if (next === current) return
  try { localStorage.setItem(ORIENTATION_KEY, String(next)) } catch { /* the choice lasts the session */ }
  publish(next)
  window.notemind.preferenceSet('orientation',next).catch(()=>{})
}

// A choice made in another open project window is global here too. Do not write it back and echo the event.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== ORIENTATION_KEY && event.key !== null) return
    try { if (event.storageArea !== null && event.storageArea !== localStorage) return } catch { return }
    publish(event.key === null ? load() : parseOrientation(event.newValue))
  })
}

export const subscribeOrientation = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * The tablet's own shape (long side over short side, from Wintab), or null when no tablet is known. The sheet is the whole tablet, so it takes
 * THIS shape (turned by the orientation) rather than the screen's: a circle on the tablet is a circle on the sheet.
 */
let tabletShape: number | null = null
export const tabletAspect = (): number | null => tabletShape
export function setTabletAspect(aspect: number | null): void {
  const next = aspect !== null && aspect >= 1 && aspect < 5 ? aspect : null
  if (next === tabletShape) return
  tabletShape = next
  listeners.forEach((listener) => listener())
}

export const useOrientation = (): Orientation =>
  useSyncExternalStore(subscribeOrientation, orientation)

/** Keep the Wacom's menu bars with the page when the display is physically turned. */
export const PAD_CHROME_ORIENTATION_KEY = "notemind.padChromeOrientation"
function loadPadChromeOrientation(): boolean {
  try { return localStorage.getItem(PAD_CHROME_ORIENTATION_KEY) === "true" } catch { return false }
}
let rotatePadChrome = loadPadChromeOrientation()
let padChromeVersion = 0
const padChromeListeners = new Set<() => void>()
export const padChromeOrientation = (): boolean => rotatePadChrome
function publishPadChromeOrientation(next: boolean): void {
  padChromeVersion++
  if (next === rotatePadChrome) return
  rotatePadChrome = next
  padChromeListeners.forEach(listener => listener())
}
export function setPadChromeOrientation(next: boolean): void {
  const value = next === true
  try { localStorage.setItem(PAD_CHROME_ORIENTATION_KEY, String(value)) } catch { /* the choice lasts the session */ }
  publishPadChromeOrientation(value)
  window.notemind.preferenceSet('padChromeOrientation', value).catch(() => {})
}
export const subscribePadChromeOrientation = (listener: () => void): (() => void) => {
  padChromeListeners.add(listener)
  return () => { padChromeListeners.delete(listener) }
}
export const usePadChromeOrientation = (): boolean =>
  useSyncExternalStore(subscribePadChromeOrientation, padChromeOrientation)

if (typeof window !== "undefined") {
  window.addEventListener("storage", event => {
    if (event.key !== PAD_CHROME_ORIENTATION_KEY && event.key !== null) return
    try { if (event.storageArea !== null && event.storageArea !== localStorage) return } catch { return }
    publishPadChromeOrientation(event.key === null ? loadPadChromeOrientation() : event.newValue === "true")
  })
}

const receiveOrientation=value=>{if(value==null)return;const next=parseOrientation(value);try{localStorage.setItem(ORIENTATION_KEY,String(next))}catch{}publish(next)};
const initialOrientationVersion=orientationVersion;
window.notemind.preferenceGet('orientation').then(value=>{if(orientationVersion===initialOrientationVersion)receiveOrientation(value)}).catch(()=>{});
window.notemind.onPreference(({key,value})=>{if(key==='orientation')receiveOrientation(value)});

const receivePadChromeOrientation = value => {
  if (typeof value !== "boolean") return
  try { localStorage.setItem(PAD_CHROME_ORIENTATION_KEY, String(value)) } catch { /* session choice still applies */ }
  publishPadChromeOrientation(value)
}
const initialPadChromeVersion = padChromeVersion
window.notemind.preferenceGet('padChromeOrientation').then(value => {
  if (padChromeVersion === initialPadChromeVersion) receivePadChromeOrientation(value)
}).catch(() => {})
window.notemind.onPreference(({key,value}) => { if (key === 'padChromeOrientation') receivePadChromeOrientation(value) })
