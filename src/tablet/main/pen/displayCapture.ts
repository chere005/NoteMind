import { spawn, type ChildProcess } from "node:child_process"
import type { PenSample } from "../../shared/pen"
export interface OneCaptureStatus { state: "checking" | "listening" | "active" | "needs-input-monitoring" | "unavailable" | "failed" | "idle"; reason: string | null }
const WACOM_ONE_INPUT_MONITORING = "Using the Wacom driver for pen input. Independent capture could not get access; you can retry it after checking System Settings."
function parseHelperLine(text: string): any { try {const value=JSON.parse(text);return value && typeof value.k === "string" ? value : null} catch {return null} }

export function sampleOf(r: { f: number; x: number; y: number; p: number }, device: { maxX: number; maxY: number; maxP: number }, t: number): PenSample | null {
  const inRange = (r.f & 0x80) !== 0
  if (inRange && (r.f & 0x40) === 0) return null
  const ready = (r.f & 0x20) !== 0
  const clamp = (v: number): number => (Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0)
  const tip = inRange && ready && (r.f & 0x01) !== 0
  return {
    t,
    x: clamp(r.x / device.maxX),
    y: clamp(1 - r.y / device.maxY),
    p: tip ? clamp(r.p / device.maxP) : 0,
    tip,
    // Keep physical lower/upper names identical to the passive feed and driver pointer bits.
    lower: inRange && ready && (r.f & 0x02) !== 0,
    upper: inRange && ready && (r.f & 0x04) !== 0,
    eraser: inRange && (r.f & 0x08) !== 0,
    inRange,
    backend: "machid",
  }
}

export type OneCaptureSpawner = (file: string, args: string[]) => ChildProcess

/**
 * The Wacom One display's independent pen input. Main owns the single controller and routes its samples to the active pad owner;
 * the controller itself owns no BrowserWindow and never guesses which owner is active. Main renews the child lease only after a
 * renderer heartbeat and its own focus/visibility audit. The helper checks Input Monitoring without raising a prompt.
 */
export class MacWacomOneCaptureController {
  private child: ChildProcess | null = null
  private ownerId: number | null = null
  private generation = 0
  private device: { maxX: number; maxY: number; maxP: number } | null = null
  private lastSample: PenSample | null = null
  private currentStatus: OneCaptureStatus = { state: "idle", reason: null }
  private readonly sampleListeners = new Set<(ownerId: number, sample: PenSample) => void>()
  private readonly statusListeners = new Set<(ownerId: number, status: OneCaptureStatus) => void>()

  constructor(
    private readonly helper: string | null,
    private readonly now: () => number,
    private readonly spawner: OneCaptureSpawner = (file, args) => spawn(file, args, { stdio: ["pipe", "pipe", "ignore"] }),
  ) {}

  onSample(listener: (ownerId: number, sample: PenSample) => void): () => void {
    this.sampleListeners.add(listener)
    return () => { this.sampleListeners.delete(listener) }
  }

  onStatus(listener: (ownerId: number, status: OneCaptureStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => { this.statusListeners.delete(listener) }
  }

  status(): OneCaptureStatus { return { ...this.currentStatus } }

  start(ownerId: number): void {
    if (!Number.isSafeInteger(ownerId) || ownerId <= 0) return
    if (this.child && this.ownerId === ownerId) return
    if (this.child || this.ownerId !== null) this.stop("pad owner changed")
    this.ownerId = ownerId
    this.device = null
    this.lastSample = null
    const gen = ++this.generation
    this.setStatus({ state: "checking", reason: null })
    if (!this.helper) { this.setStatus({ state: "unavailable", reason: "the native Wacom One helper is not in this build" }); return }

    let child: ChildProcess
    try { child = this.spawner(this.helper, ["--capture-one"]) }
    catch (error) {
      this.setStatus({ state: "failed", reason: `the Wacom One helper could not start: ${(error as Error)?.message ?? String(error)}` })
      return
    }
    this.child = child
    // Pipe writes can fail asynchronously after write() returns; try/catch cannot handle the stream's error event.
    child.stdin?.on("error", (error) => this.fail(gen, ownerId, "failed", `the Wacom One heartbeat pipe closed: ${error.message}`))
    child.stdout?.on("error", (error) => this.fail(gen, ownerId, "failed", `the Wacom One sample pipe closed: ${error.message}`))
    let buffered = ""
    child.stdout?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => {
      if (gen !== this.generation || this.ownerId !== ownerId) return
      buffered += chunk
      let nl: number
      while ((nl = buffered.indexOf("\n")) >= 0) {
        if (gen !== this.generation || this.ownerId !== ownerId) return
        const line = parseHelperLine(buffered.slice(0, nl))
        buffered = buffered.slice(nl + 1)
        if (!line) continue
        switch (line.k) {
          case "access":
            if (line.v !== "granted") this.fail(gen, ownerId, "needs-input-monitoring", WACOM_ONE_INPUT_MONITORING)
            break
          case "device":
            if (line.pid !== 0x03CE || line.maxX !== 25632 || line.maxY !== 14418 || line.maxP !== 4095) {
              this.fail(gen, ownerId, "failed", "the Wacom One report descriptor does not match the captured device")
              break
            }
            this.device = { maxX: line.maxX, maxY: line.maxY, maxP: line.maxP }
            break
          case "listening":
            this.setStatus({ state: "listening", reason: null })
            break
          case "opened":
            if (line.mode === "one") this.setStatus({ state: "active", reason: null })
            break
          case "p": {
            if (!this.device || this.currentStatus.state !== "active") break
            const sample = sampleOf(line, this.device, this.now())
            if (!sample) break
            if (typeof line.tiltX === "number") sample.tiltX = Math.max(-90, Math.min(90, line.tiltX))
            if (typeof line.tiltY === "number") sample.tiltY = Math.max(-90, Math.min(90, line.tiltY))
            this.lastSample = sample
            for (const listener of this.sampleListeners) { try { listener(ownerId, sample) } catch { /* one pad listener cannot interrupt capture */ } }
            break
          }
          case "refused":
            if (line.permission && line.permission !== "granted") this.fail(gen, ownerId, "needs-input-monitoring", WACOM_ONE_INPUT_MONITORING)
            else this.fail(gen, ownerId, /unavailable|could not be opened|no Wacom One/.test(line.why) ? "unavailable" : "failed", line.why)
            break
          case "closed":
            this.fail(gen, ownerId, "failed", line.why)
            break
          case "raw":
            console.log(`[pen] Wacom One unrecognized report prefix: ${line.hex.split(" ").slice(0, 3).join(" ")}`)
            break
          case "log":
            console.log(`[pen] Wacom One helper: ${line.m}`)
            break
          case "buttons":
            break
        }
      }
    })
    child.on("error", (error) => { if (gen === this.generation) this.fail(gen, ownerId, "failed", `the Wacom One helper failed: ${error.message}`) })
    child.on("exit", (code) => {
      if (gen !== this.generation) return
      this.child = null
      if (this.currentStatus.state !== "needs-input-monitoring" && this.currentStatus.state !== "unavailable") {
        this.fail(gen, ownerId, code === 0 ? "idle" : "failed", code === 0 ? "capture stopped" : `the Wacom One helper ended (${code ?? "signal"})`)
      }
    })
  }

  /** Called only for a fresh, validated pad-renderer heartbeat after main checked this owner is still active. */
  heartbeat(ownerId: number): boolean {
    if (ownerId !== this.ownerId || !this.child?.stdin?.writable || this.child.stdin.destroyed || this.child.stdin.writableEnded) return false
    try { return this.child.stdin.write("ping\n") } catch { this.stop("controller heartbeat failed"); return false }
  }

  stop(reason = "capture stopped"): void {
    const ownerId = this.ownerId
    if (ownerId === null) return
    ++this.generation
    const child = this.child
    this.child = null
    this.emitRelease(ownerId)
    this.device = null
    this.lastSample = null
    if (child) {
      try { child.stdin?.end() } catch { /* ignore */ }
      try { child.kill("SIGTERM") } catch { /* ignore */ }
    }
    this.setStatus({ state: "idle", reason })
    this.ownerId = null
  }

  private fail(gen: number, ownerId: number, state: OneCaptureStatus["state"], reason: string): void {
    if (gen !== this.generation || ownerId !== this.ownerId) return
    ++this.generation
    const child = this.child
    this.child = null
    this.emitRelease(ownerId)
    this.device = null
    this.lastSample = null
    if (child) {
      try { child.stdin?.end() } catch { /* ignore */ }
      try { child.kill("SIGTERM") } catch { /* ignore */ }
    }
    this.setStatus({ state, reason })
  }

  private emitRelease(ownerId: number): void {
    const last = this.lastSample
    if (!last?.inRange) return
    const lifted: PenSample = { ...last, t: this.now(), p: 0, tip: false, lower: false, upper: false, eraser: false, inRange: false }
    for (const listener of this.sampleListeners) { try { listener(ownerId, lifted) } catch { /* ignore */ } }
  }

  private setStatus(status: OneCaptureStatus): void {
    this.currentStatus = status
    const ownerId = this.ownerId
    if (ownerId === null) return
    for (const listener of this.statusListeners) { try { listener(ownerId, { ...status }) } catch { /* ignore */ } }
  }
}
