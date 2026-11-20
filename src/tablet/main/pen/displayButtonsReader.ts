import { spawn, type ChildProcess } from "node:child_process"
import { NO_BUTTONS, type TraceSink } from "../../shared/pen"
import type { ButtonsFeed } from "./buttonsFeed"

function parseHelperLine(text: string): any { try { const value=JSON.parse(text); return value && typeof value.k === "string" ? value : null } catch { return null } }

export type ButtonsSpawner = (file: string, args: string[]) => ChildProcess
export type ContactPoint = { x: number; y: number; start: boolean; buttons: number; pressure: number; tiltX: number; tiltY: number }

/** Restart after the helper dies by itself: 2 s, 10 s, 30 s, then not until `start()` is called again (a resume, an unlock). */
export const BUTTONS_RESTART_MS = [2000, 10000, 30000] as const

/** Reads physical button changes and supported contact coordinates from the passive macOS helper. */
export class MacPenButtons {
	contactPoint?: (point: ContactPoint) => void
  private child: ChildProcess | null = null
  private generation = 0
  private restarts = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly helper: string | null,
    private readonly feed: ButtonsFeed,
    private readonly trace: Pick<TraceSink, "event" | "raw">,
    private readonly now: () => number,
    private readonly spawner: ButtonsSpawner = (file, args) => spawn(file, args, { stdio: ["pipe", "pipe", "ignore"] }),
    private readonly setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = (fn, ms) => {
      const handle = setTimeout(fn, ms)
      handle.unref?.()
      return handle
    },
  ) {}

  /** Whether the helper is running now. */
  running(): boolean { return this.child !== null }

  /** Run the helper if it is not running (also the way back after it gave up: a resume, an unlock). Never throws. */
  start(): boolean {
    if (!this.helper) return false
    if (this.child) return true
    this.restarts = 0
    return this.launch()
  }

  private launch(): boolean {
    if (!this.helper || this.child) return this.child !== null
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null }
    const gen = ++this.generation
    let child: ChildProcess
    try { child = this.spawner(this.helper, ["--buttons"]) } catch (error) {
      this.trace.event("manager", "buttons-spawn-failed", { message: (error as Error)?.message })
      this.again(gen)
      return false
    }
    this.child = child
    // Pipe failures belong to the stream, not ChildProcess. Keep these listeners through shutdown for late errors.
    const failed = (error: Error, event: string): void => {
      if (gen !== this.generation || this.child !== child) return
      this.child = null
      const next = ++this.generation
      this.feed.set({ ...NO_BUTTONS })
      this.trace.event("manager", event, { message: error.message })
      try { child.stdin?.destroy() } catch { /* already closed */ }
      try { child.kill("SIGTERM") } catch { /* already exited */ }
      this.again(next)
    }
    child.stdin?.on("error", (error) => failed(error, "buttons-pipe-error"))
    child.stdout?.on("error", (error) => failed(error, "buttons-pipe-error"))
    let buffered = ""
    child.stdout?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => {
      if (gen !== this.generation || this.child !== child) return
      buffered += chunk
      let nl: number
      while ((nl = buffered.indexOf("\n")) >= 0) {
        if (gen !== this.generation || this.child !== child) return
        const line = parseHelperLine(buffered.slice(0, nl))
        buffered = buffered.slice(nl + 1)
        if (line) this.line(line)
      }
    })
    child.on("error", (error) => failed(error, "buttons-error"))
    child.on("exit", (code, signal) => {
      if (gen !== this.generation || this.child !== child) return
      this.child = null
      const next = ++this.generation
      this.feed.set({ ...NO_BUTTONS })
      this.trace.event("manager", "buttons-ended", { code, signal })
      this.again(next)
    })
    return true
  }

  private line(line: HelperLine): void {
    switch (line.k) {
      case "opened":
        if (line.mode !== "buttons") return
        this.restarts = 0
        this.trace.event("manager", "buttons-opened", { name: line.name ?? null, pid: line.pid ?? null })
        this.feed.set({ ...NO_BUTTONS, present: true, ...(line.contactPosition === true ? { contactPosition: true } : {}) })
        break
	  case "buttons": {
		const { contactPosition } = this.feed.get()
		this.feed.set({ present: true, range: line.range === true, tip: line.tip === true, lower: line.lower === true, upper: line.upper === true, ...(contactPosition ? { contactPosition } : {}) })
		// (a trace of what the display reports, for the pen buttons' contract: docs/PEN-BUTTONS.md)
		this.trace.event("manager", "buttons", { tip: line.tip === true, lower: line.lower === true, upper: line.upper === true, range: line.range === true })
		break
	  }
	  case "contact-point": {
		const { contactPosition, tip, range } = this.feed.get()
		const { x, y, p, f, tiltX, tiltY } = line
		if (!contactPosition || !tip || !range || ![x, y, p, f, tiltX, tiltY].every(Number.isInteger)) break
		if (x < 0 || x > 25632 || y < 0 || y > 14418 || p < 0 || p > 4095 || f < 0xe0 || f > 0xef || !(f & 1)) break
		if (tiltX < -64 || tiltX > 63 || tiltY < -64 || tiltY > 63) break
		const buttons = (f & 7) | (f & 8 ? 32 : 0)
		this.contactPoint?.({ x: x / 25632, y: y / 14418, start: line.start === true, buttons, pressure: p / 4095 || .5, tiltX, tiltY })
		break
	  }
      case "closed":
        this.trace.event("manager", "buttons-closed", { why: line.why })
        this.feed.set({ ...NO_BUTTONS })
        break
      case "raw":
        this.trace.raw("wintab-data", this.now(), line.hex, "pen display: not a button report")
        break
      case "log":
        this.trace.event("manager", "buttons-helper", { m: line.m })
        break
    }
  }

  /** The helper died by itself: try again a few times, patiently. */
  private again(gen: number): void {
    if (gen !== this.generation || this.restarts >= BUTTONS_RESTART_MS.length) return
    const wait = BUTTONS_RESTART_MS[this.restarts++]!
    this.timer = this.setTimer(() => { this.timer = null; if (gen === this.generation && !this.child) this.launch() }, wait)
  }

  /** Let go: stdin closing is the helper's way out; SIGTERM as well, for one stuck elsewhere. Idempotent. */
  stop(): void {
    this.generation++
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null }
    const child = this.child
    this.child = null
    this.restarts = 0
    this.feed.set({ ...NO_BUTTONS })
    if (!child) return
    try { child.stdin?.end() } catch { /* ignore */ }
    try { child.kill("SIGTERM") } catch { /* ignore */ }
  }
}
