import { spawn, type ChildProcess } from "node:child_process"
import { NO_BUTTONS, type TraceSink } from "../../shared/pen"
import type { ButtonsFeed } from "./buttonsFeed"

function parseHelperLine(text: string): any { try { const value=JSON.parse(text); return value && typeof value.k === "string" ? value : null } catch { return null } }

export type ButtonsSpawner = (file: string, args: string[]) => ChildProcess

/** Restart after the helper dies by itself: 2 s, 10 s, 30 s, then not until `start()` is called again (a resume, an unlock). */
export const BUTTONS_RESTART_MS = [2000, 10000, 30000] as const

/**
 * The pen display's own side buttons (the Wacom One 12): the helper's `--buttons` mode runs for as long as the app does, finds the
 * display's vendor interface whenever it is there and says what changed of {tip, lower, upper, range}. This turns its lines into the
 * feed's state: `present` while the interface is open, all clear (and not present) when the display goes, the helper ends or dies.
 * It opens no tablet, seizes nothing and asks for no permission, so it needs no gate: it simply runs. The helper being absent (no
 * Swift when the app was built, another platform) makes `start()` do nothing and leaves the feed as it was: not present.
 */
export class MacPenButtons {
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
    const streamFailed = (error: Error): void => {
      if (gen !== this.generation || this.child !== child) return
      this.child = null
      const next = ++this.generation
      this.feed.set({ ...NO_BUTTONS })
      this.trace.event("manager", "buttons-pipe-error", { message: error.message })
      try { child.stdin?.destroy() } catch { /* already closed */ }
      try { child.kill("SIGTERM") } catch { /* already exited */ }
      this.again(next)
    }
    child.stdin?.on("error", streamFailed)
    child.stdout?.on("error", streamFailed)
    let buffered = ""
    child.stdout?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => {
      if (gen !== this.generation) return
      buffered += chunk
      let nl: number
      while ((nl = buffered.indexOf("\n")) >= 0) {
        const line = parseHelperLine(buffered.slice(0, nl))
        buffered = buffered.slice(nl + 1)
        if (line) this.line(line)
      }
    })
    child.on("error", (error) => {
      if (gen !== this.generation) return
      this.trace.event("manager", "buttons-error", { message: error.message })
    })
    child.on("exit", (code, signal) => {
      if (gen !== this.generation) return
      this.child = null
      this.feed.set({ ...NO_BUTTONS })
      this.trace.event("manager", "buttons-ended", { code, signal })
      this.again(gen)
    })
    return true
  }

  private line(line: HelperLine): void {
    switch (line.k) {
      case "opened":
        if (line.mode !== "buttons") return
        this.restarts = 0
        this.trace.event("manager", "buttons-opened", { name: line.name ?? null, pid: line.pid ?? null })
        this.feed.set({ ...NO_BUTTONS, present: true })
        break
      case "buttons":
        this.feed.set({ present: true, range: line.range === true, tip: line.tip === true, lower: line.lower === true, upper: line.upper === true })
        break
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
