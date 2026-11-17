import type { OneCaptureStatus } from "./displayCapture"

export interface PadCaptureDriver {
  start(ownerId: number): void
  heartbeat(ownerId: number): boolean
  stop(reason: string): void
}

/** A renderer lease is renewed only by the eligible pad's own page, never by the main timer. */
export function createPadCaptureLease(deps: { driver: PadCaptureDriver; target(): number | null; now(): number }) {
  let owner: number | null = null
  let lastBeat = 0
  let retryAt = 0
  const stop = (reason: string) => {
    if (owner === null) return
    owner = null
    deps.driver.stop(reason)
  }
  return {
    heartbeat(sender: number) {
      if (sender !== deps.target()) return
      if (owner !== null && owner !== sender) stop("pad owner changed")
      if (owner === null) {
        if (deps.now() < retryAt) return
        owner = sender
        lastBeat = deps.now()
        deps.driver.start(sender)
      }
      if (owner !== sender) return
      lastBeat = deps.now()
      deps.driver.heartbeat(sender)
    },
    audit() {
      if (owner !== null && (owner !== deps.target() || deps.now() - lastBeat > 750)) stop("pad unavailable or renderer lease expired")
    },
    status(sender: number, status: OneCaptureStatus) {
      if (sender !== owner) return
      if (status.state === "needs-input-monitoring") {
        // The controller has already released the helper. Stopping it again would replace this actionable status
        // with idle; periodic retries would keep seizing/releasing the device while access is still denied.
        retryAt = Infinity
        owner = null
      } else if (["failed", "unavailable", "idle"].includes(status.state)) {
        retryAt = deps.now() + 5000
        stop(status.reason ?? status.state)
      }
    },
    retry() {
      const permissionBlocked = retryAt === Infinity
      retryAt = 0
      // A failed controller retains its old owner for status reporting. Release it before the next start so its
      // idle notification cannot reenter status() and cancel a newly established renderer lease.
      if (permissionBlocked) deps.driver.stop("pen input retry requested")
    },
    stop(sender?: number) { if (sender === undefined || owner === sender) stop("pad input stopped") },
  }
}
