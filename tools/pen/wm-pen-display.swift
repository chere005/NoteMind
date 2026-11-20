// wm-pen: the Mac's tablet reader for NoteMind (src/tablet/main/pen/macPenBackend.ts starts it).
//
// THE WACOM DRIVER CANNOT BE ASKED TO LET GO OF THE POINTER on a Mac (measured on macOS:
// its Apple Event interface answers reads and ignores every write, and CGAssociateMouseAndMouseCursorPosition does
// nothing). So while the Tablet sheet is in front, this opens the tablet's HID device with
// kIOHIDOptionsTypeSeizeDevice — a seized device delivers nothing to the driver or WindowServer, so the pointer stays
// where the trackpad left it — and writes the pen's raw reports to stdout. Ending the process (stdin closed, SIGTERM)
// closes the device and gives the pen back; the kernel does that too if the process dies any other way.
//
// Opening a pointer-class HID device needs INPUT MONITORING, which macOS attributes to NoteMind.app (this helper's
// responsible process). Undecided: macOS's question is put up once. Denied: says so and exits 3.
//
// One JSON object per line on stdout:
//   {"k":"access","v":"granted"|"denied"|"undecided"}
//   {"k":"device","name":…,"pid":…,"maxX":…,"maxY":…,"maxP":…}   the tablet about to be seized
//   {"k":"opened"} | {"k":"refused","why":…}                        exit 2 after a refusal, 4 when there is no tablet,
//                                                                    6 when the only Wacom device is a pen display ("penDisplay":true)
//   {"k":"p","f":flags,"x":…,"y":…,"p":…}                            one pen report (the Bamboo-pen layout below)
//   {"k":"raw","hex":…}                                              the first reports that are not that, for pen.log
//   {"k":"log","m":…}
//
// The generic tablet mode still refuses pen displays (Wacom One 12/13, Cintiq, MobileStudio, Movink). The independent One pad path
// is `--capture-one`: it validates the exact pen-report candidates nonexclusively, then seizes only the selected report source,
// any known sibling needed to keep the driver from seeing that report, and this device's page 1 / usage 2 Mouse interface. It waits
// for a clean in-range hover first, avoiding a lost pointer-up mid-stroke, and never takes the Mac's other mouse or trackpad devices.
// The old 2026-10-28 attempt seized all interfaces and decoded report 0x1e as Bamboo report 2, so it drew nothing and left the
// pointer dead; this path uses the captured One layout and verifies a fresh sample after selective seizure.
// Such a product is left out of the generic tablet mode; with nothing else plugged in the
// answer is {"k":"refused","why":"a pen display draws by itself","penDisplay":true} and exit 6, and the Intuos / One by Wacom
// small (CTL-472) is still seized exactly as before, also when a pen display is plugged in beside it.
//
// Passive mode (`--buttons`) opens the vendor interface (usage page 0xFFD1, usage 0x300) without seizing it.
// It reports physical switches independently of Wacom Center mappings. On Wacom One 12 (056a:03ce) it also reports
// valid contact positions and pressure. The final contact position precedes the report that lifts the tip.
// `--decode-passive` replays hex fixtures through the same decoder without opening a device.
//
// The independent input mode (`--capture-one`) checks Input Monitoring without prompting, validates a report source and clean hover,
// then exclusively opens only that known source, any required known sibling, and the One Mouse interface. The child releases on
// EOF/SIGTERM, invalid/stale in-range traffic or a 2s missed lease.
//
// Explicit consent request: `wm-pen --request-access` asks only for Input Monitoring and reports {"k":"access","v":...}.
// It exits before matching, opening or seizing any device.
//
// Read-only diagnostics that never seize, never ask for Input Monitoring and do not run the pen:
//   wm-pen --classify "<product name>" <product id, decimal>   {"k":"verdict",…}   the rule alone (the tests ask it)
//   wm-pen --list                                              {"k":"list",…}      each Wacom HID device and what would be done with it
//   wm-pen --decode "<report bytes, hex>"                      {"k":"buttons",…}   the pen display's report as the buttons mode reads it
//                                                                                   (or {"k":"not-a-button-report"}); the tests ask it
//   wm-pen --describe-one                                       {"k":"descriptor",…} the captured Wacom One 12 pen report layout
//   wm-pen --decode-one "<report bytes, hex>"                  {"k":"p",…}         decode a captured report (no device access)
//   wm-pen --check-one-hover <status-hex> <report-age-ms>       {"k":"hover-ready",…} test the fresh-hover acquisition rule
//
// THE REPORT (the One by Wacom / Bamboo-pen class, its layout as the Linux driver's `wacom_bpt_pen` reads it):
//   byte 0 the report id, 2 · byte 1 flags: 0x80 in range, 0x40 x/y good, 0x20 tip/switches/pressure good,
//   0x08 eraser, 0x04 upper switch, 0x02 lower switch, 0x01 tip · bytes 2–3 x LE · 4–5 y LE (down) · 6–7 pressure LE.

import Foundation
import IOKit
import IOKit.hid

let wacomVendor = 0x056A
setvbuf(stdout, nil, _IOLBF, 0)
var captureOutputMode = false
var captureOutputBroken = false
var captureOutputFailureHandler: (() -> Never)?

func enableCaptureOutput() -> Bool {
    let flags = fcntl(STDOUT_FILENO, F_GETFL)
    guard flags >= 0, fcntl(STDOUT_FILENO, F_SETFL, flags | O_NONBLOCK) >= 0 else { return false }
    captureOutputMode = true
    signal(SIGPIPE, SIG_IGN)
    return true
}

func captureOutputFailed() -> Never {
    captureOutputBroken = true
    if let captureOutputFailureHandler { captureOutputFailureHandler() }
    exit(5)
}

func say(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else { return }
    guard captureOutputMode else { print(line); return }
    guard !captureOutputBroken else { return }
    let bytes = Array((line + "\n").utf8)
    var written = 0
    while written < bytes.count {
        let count = bytes.withUnsafeBytes { raw -> Int in
            guard let base = raw.baseAddress else { return -1 }
            return Darwin.write(STDOUT_FILENO, base.advanced(by: written), bytes.count - written)
        }
        if count > 0 { written += count; continue }
        if count < 0 && errno == EINTR { continue }
        captureOutputFailed()
    }
}
func log(_ message: String) { say(["k": "log", "m": message]) }

func number(_ device: IOHIDDevice, _ key: String) -> Int {
    (IOHIDDeviceGetProperty(device, key as CFString) as? NSNumber)?.intValue ?? 0
}
func text(_ device: IOHIDDevice, _ key: String) -> String {
    (IOHIDDeviceGetProperty(device, key as CFString) as? String) ?? ""
}
func hex(_ code: IOReturn) -> String { String(format: "0x%08x", UInt32(bitPattern: code)) }

// ---- which Wacom products are a tablet to take

enum Verdict: String {
    case take
    case penDisplay = "pen-display"     // draws by itself: left to the Wacom driver and the window's own pen events
    case notATablet = "not-a-tablet"    // the cable's USB descriptor device
}

/// Wacom One 12 (DTC-121), as ioreg shows it: product "Wacom One pen display 11.6"", product id 974.
let penDisplayProducts: Set<Int> = [0x03CE]
/// The "Wacom Billboard" that rides with a pen display's USB-C cable.
let billboardProducts: Set<Int> = [0x03CF]
let penDisplayNames = ["pen display", "cintiq", "mobilestudio", "movink"]

func verdict(name: String, pid: Int) -> Verdict {
    let lowered = name.lowercased()
    if penDisplayProducts.contains(pid) || penDisplayNames.contains(where: { lowered.contains($0) }) { return .penDisplay }
    if billboardProducts.contains(pid) || lowered.contains("billboard") { return .notATablet }
    return .take
}

let arguments = Array(CommandLine.arguments.dropFirst())
func access() -> String {
    switch IOHIDCheckAccess(kIOHIDRequestTypeListenEvent) {
    case kIOHIDAccessTypeGranted: return "granted"
    case kIOHIDAccessTypeDenied: return "denied"
    default: return "undecided"
    }
}
if arguments.first == "--request-access" {
    guard arguments.count == 1 else { FileHandle.standardError.write(Data("usage: wm-pen --request-access\n".utf8)); exit(64) }
    var answer = access()
    if answer != "granted" { answer = IOHIDRequestAccess(kIOHIDRequestTypeListenEvent) ? "granted" : access() }
    say(["k": "access", "v": answer])
    exit(0)
}
if arguments.first == "--stress-capture-output" {
    guard arguments.count == 1, enableCaptureOutput() else { exit(64) }
    let payload = String(repeating: "x", count: 8192)
    while true { say(["k": "stress", "payload": payload]) }
}

if arguments.first == "--check-one-callback" {
    guard arguments.count == 1 else { FileHandle.standardError.write(Data("usage: wm-pen --check-one-callback\n".utf8)); exit(64) }
    say(["k": "callback-context", "counts": checkOneCallbackContext()])
    exit(0)
}

if arguments.first == "--classify" {
    guard arguments.count == 3, let pid = Int(arguments[2]) else { FileHandle.standardError.write(Data("usage: wm-pen --classify \"<product name>\" <product id>\n".utf8)); exit(64) }
    say(["k": "verdict", "name": arguments[1], "pid": pid, "v": verdict(name: arguments[1], pid: pid).rawValue])
    exit(0)
}

// ---- the tablet's HID devices (the pointer's first)

func devices() -> [IOHIDDevice] {
    let matching = IOServiceMatching(kIOHIDDeviceKey) as NSMutableDictionary
    matching[kIOHIDVendorIDKey] = wacomVendor
    var iterator: io_iterator_t = 0
    guard IOServiceGetMatchingServices(kIOMainPortDefault, matching, &iterator) == KERN_SUCCESS else { return [] }
    defer { IOObjectRelease(iterator) }
    var found: [IOHIDDevice] = []
    while case let service = IOIteratorNext(iterator), service != 0 {
        defer { IOObjectRelease(service) }
        if let device = IOHIDDeviceCreate(kCFAllocatorDefault, service) { found.append(device) }
    }
    // A tablet that moves the pointer (usage page 1, usage 2) first; the rest of the same product after it.
    return found.sorted {
        let a = number($0, kIOHIDPrimaryUsagePageKey) == 1 && number($0, kIOHIDPrimaryUsageKey) == 2
        let b = number($1, kIOHIDPrimaryUsagePageKey) == 1 && number($1, kIOHIDPrimaryUsageKey) == 2
        return a && !b
    }
}

/** The largest logical maximum of an input element with this usage, in report 2. */
func logicalMax(_ device: IOHIDDevice, page: Int, usage: Int) -> Int {
    guard let elements = IOHIDDeviceCopyMatchingElements(device, nil, IOOptionBits(kIOHIDOptionsTypeNone)) as? [IOHIDElement] else { return 0 }
    var best = 0
    for element in elements where Int(IOHIDElementGetUsagePage(element)) == page && Int(IOHIDElementGetUsage(element)) == usage {
        if IOHIDElementGetReportID(element) == 2 { best = max(best, IOHIDElementGetLogicalMax(element)) }
    }
    return best
}

/// Whether the device's report 2 carries absolute X and Y (a tablet reading a pen, not a mouse).
func hasAbsoluteXY(_ device: IOHIDDevice) -> Bool {
    logicalMax(device, page: 1, usage: 0x30) > 1000 && logicalMax(device, page: 1, usage: 0x31) > 1000
}
func verdictOf(_ device: IOHIDDevice) -> Verdict {
    verdict(name: text(device, kIOHIDProductKey), pid: number(device, kIOHIDProductIDKey))
}

if arguments.first == "--list" {
    for device in devices() {
        say(["k": "list", "name": text(device, kIOHIDProductKey), "pid": number(device, kIOHIDProductIDKey),
             "page": number(device, kIOHIDPrimaryUsagePageKey), "usage": number(device, kIOHIDPrimaryUsageKey),
             "absoluteXY": hasAbsoluteXY(device), "v": verdictOf(device).rawValue])
    }
    exit(0)
}

// ---- a pen display's side buttons (usage page 0xFFD1, usage 0x300; see the header)

/// The display’s physical switches and proximity, independent of its contact coordinates.
struct Side: Equatable {
    var tip = false, lower = false, upper = false, range = false
}

/**
 * The Wacom One 12's pen report, as the vendor interface delivers it (decoded on Sean's pen, 2026-10-28): byte 0 the report id
 * 0x1E, byte 1 0x01, byte 2 the STATUS — 0x80 in range, 0x40 valid (hovering), 0x01 tip down, 0x02 the lower side button, 0x04 the
 * upper one (seen: c0 hover, c1 tip, c2 hover + lower, c4 hover + upper, c3 tip + lower, c5 tip + upper; 0x80 alone is an
 * invalid/stale sample, sometimes emitted as the pen leaves) — then X, Y and the pressure, which this does not read. A button or the tip only counts in range.
 * Any other shape is not a button report (nil).
 */
func sideState(_ bytes: [UInt8]) -> Side? {
    // The pen's standard HID report (ID 6, the one the driver reads): contact count, then tip / barrel / secondary barrel
    // switch in bits 0-2 of byte 2, eraser bit 4, invert bit 5, in range bit 6. Barrel is the button nearer the tip.
    if bytes.count >= 3, bytes[0] == 0x06 {
        let status = bytes[2]
        let range = status & 0x40 != 0
        return Side(tip: range && status & 0x01 != 0, lower: range && status & 0x02 != 0, upper: range && status & 0x04 != 0, range: range)
    }
    guard bytes.count >= 3, bytes[0] == 0x1E, bytes[1] <= 1 else { return nil }
    if bytes[1] == 0 { return Side() }
    let status = bytes[2]
    let range = status & 0xC0 == 0xC0
    return Side(tip: range && status & 0x01 != 0, lower: range && status & 0x02 != 0, upper: range && status & 0x04 != 0, range: range)
}
func sideLine(_ side: Side) -> [String: Any] {
    ["k": "buttons", "tip": side.tip, "lower": side.lower, "upper": side.upper, "range": side.range]
}
func hexLine(_ bytes: [UInt8]) -> String { bytes.map { String(format: "%02x", $0) }.joined(separator: " ") }

/// The physical Mac capture in diagnostics/hid-descriptors.ndjson recorded the exact Wacom One 12 (056a:03ce) descriptor.
/// Report 0x1e is 34 bytes total: contact count at byte 1; switches/status at byte 2; X[3...5], Y[6...8], pressure[9...10],
/// and signed tilt X/Y at [11...12]/[13...14]. The remaining descriptor fields are deliberately not interpreted here.
struct OnePen: Equatable {
    var flags: Int
    var x: Int
    var y: Int
    var pressure: Int
    var contactCount: Int
    var tiltX: Int
    var tiltY: Int
}

func uintLE(_ bytes: [UInt8], _ offset: Int, _ count: Int) -> Int {
    (0..<count).reduce(0) { $0 | (Int(bytes[offset + $1]) << (8 * $1)) }
}

func signed16LE(_ bytes: [UInt8], _ offset: Int) -> Int {
    Int(Int16(bitPattern: UInt16(uintLE(bytes, offset, 2))))
}

/// The pen's standard report (ID 6, read from the display's own descriptor): contact count at byte 1; status at byte 2 (bit 0 tip,
/// 1 barrel, 2 secondary barrel, 5 invert, 6 in range); X[3...4] 0...25632 and Y[6...7] 0...14418, each followed by a padding byte;
/// pressure[9...10] 0...4095; tilt X/Y at [11...12]/[13...14] in hundredths of a degree. It is given the vendor report's flags and
/// whole-degree tilt, so one contact path serves both.
func standardPen(_ bytes: [UInt8]) -> OnePen? {
    guard bytes.count >= 15, bytes[0] == 0x06 else { return nil }
    let x = uintLE(bytes, 3, 2), y = uintLE(bytes, 6, 2), pressure = uintLE(bytes, 9, 2)
    guard x <= 25632, y <= 14418, pressure <= 4095 else { return nil }
    let degrees = { (offset: Int) -> Int in min(63, max(-64, Int((Double(signed16LE(bytes, offset)) / 100).rounded()))) }
    let status = bytes[2]
    let range = status & 0x40 != 0
    var flags = range ? 0x80 | 0x40 | 0x20 : 0
    if range && status & 0x01 != 0 { flags |= 0x01 }
    if range && status & 0x02 != 0 { flags |= 0x02 }
    if range && status & 0x04 != 0 { flags |= 0x04 }
    if range && status & 0x20 != 0 { flags |= 0x08 }
    return OnePen(flags: flags, x: x, y: y, pressure: pressure, contactCount: Int(bytes[1]), tiltX: degrees(11), tiltY: degrees(13))
}

func onePen(_ bytes: [UInt8]) -> OnePen? {
    if bytes.first == 0x06 { return standardPen(bytes) }
    guard bytes.count == 34, bytes[0] == 0x1E, bytes[1] <= 1 else { return nil }
    let x = uintLE(bytes, 3, 3), y = uintLE(bytes, 6, 3), pressure = uintLE(bytes, 9, 2)
    let tiltX = signed16LE(bytes, 11), tiltY = signed16LE(bytes, 13)
    guard x <= 25632, y <= 14418, pressure <= 4095, (-64...63).contains(tiltX), (-64...63).contains(tiltY) else { return nil }
    let status = bytes[2]
    let range = status & 0xC0 == 0xC0
    // The One's factory default report uses bits 0/1/2 for tip/lower/upper, bit 4 for Eraser switch,
    // and the observed c0 pair to mean an in-range, valid-position sample. Usage 0x45 Eraser is a different switch; the feed's
    // eraser-end bit comes from descriptor Usage 0x3c Invert (status bit 5), not the Usage 0x45 switch at bit 4.
    var flags = range ? 0x80 | 0x40 | 0x20 : 0
    if range && status & 0x01 != 0 { flags |= 0x01 }
    if range && status & 0x02 != 0 { flags |= 0x02 }
    if range && status & 0x04 != 0 { flags |= 0x04 }
    if range && status & 0x20 != 0 { flags |= 0x08 }
    return OnePen(flags: flags, x: x, y: y, pressure: pressure,
                  contactCount: Int(bytes[1]), tiltX: tiltX, tiltY: tiltY)
}

struct PassiveReports {
    let contactPosition: Bool
    private(set) var side = Side()
    private var lastContact: OnePen?

    init(contactPosition: Bool) { self.contactPosition = contactPosition }

    mutating func read(_ bytes: [UInt8], emit: ([String: Any]) -> Void) -> Bool {
        guard let now = sideState(bytes) else { return false }
        let changed = now != side
        side = now
        if now.tip && changed { emit(sideLine(now)) }
        if contactPosition && now.range, let position = onePen(bytes), let contact = now.tip ? position : lastContact {
            emit(["k": "contact-point", "x": position.x, "y": position.y, "p": contact.pressure,
                  "f": contact.flags, "tiltX": position.tiltX, "tiltY": position.tiltY, "start": lastContact == nil])
            lastContact = contact
        }
        if !now.tip {
            if changed { emit(sideLine(now)) }
            lastContact = nil
        }
        return true
    }
}

if arguments.first == "--decode-passive" {
    guard arguments.count > 1 else { exit(64) }
    var reports = PassiveReports(contactPosition: true)
    for report in arguments.dropFirst() {
        let bytes = report.split(separator: " ").compactMap { UInt8($0, radix: 16) }
        _ = reports.read(bytes, emit: say)
    }
    exit(0)
}

func onePenLine(_ pen: OnePen) -> [String: Any] {
    ["k": "p", "f": pen.flags, "x": pen.x, "y": pen.y, "p": pen.pressure,
     "contactCount": pen.contactCount, "tiltX": pen.tiltX, "tiltY": pen.tiltY, "cleanHover": cleanHover(pen)]
}

func cleanHover(_ pen: OnePen) -> Bool {
    (pen.flags & 0x80) != 0 && (pen.flags & 0x0F) == 0
}

func currentCleanHover(_ isClean: Bool, reportAt: Double?, now: Double, maxAge: Double = 0.25) -> Bool {
    guard isClean, let reportAt else { return false }
    let age = now - reportAt
    return age >= 0 && age <= maxAge
}

func postSeizeExpired(ownedHandles: Int, active: Bool, startedAt: Double?, now: Double, timeout: Double = 0.75) -> Bool {
    guard ownedHandles > 0, !active, let startedAt else { return false }
    let age = now - startedAt
    return age >= 0 && age > timeout
}

if arguments.first == "--decode" {
    guard arguments.count == 2 else { FileHandle.standardError.write(Data("usage: wm-pen --decode \"<report bytes, hex>\"\n".utf8)); exit(64) }
    let bytes = arguments[1].split(whereSeparator: { $0 == " " || $0 == "," }).compactMap { UInt8($0, radix: 16) }
    if let side = sideState(bytes) { say(sideLine(side)) } else { say(["k": "not-a-button-report"]) }
    exit(0)
}

if arguments.first == "--describe-one" {
    guard arguments.count == 1 else { FileHandle.standardError.write(Data("usage: wm-pen --describe-one\n".utf8)); exit(64) }
    say(["k": "descriptor", "vendor": wacomVendor, "pid": 0x03CE, "report": 0x1E, "length": 34,
         "contactCountOffset": 1, "statusOffset": 2, "xOffset": 3, "xBits": 24, "maxX": 25632,
         "yOffset": 6, "yBits": 24, "maxY": 14418, "pressureOffset": 9, "pressureBits": 16, "maxPressure": 4095,
         "tiltXOffset": 11, "tiltYOffset": 13, "tiltBits": 16, "minTilt": -64, "maxTilt": 63,
         "tipMask": 0x01, "lowerMask": 0x02, "upperMask": 0x04, "eraserSwitchMask": 0x10,
         "invertMask": 0x20, "rangeValidMask": 0xC0])
    exit(0)
}

if arguments.first == "--decode-one" {
    guard arguments.count == 2 else { FileHandle.standardError.write(Data("usage: wm-pen --decode-one \"<34-byte report as hex>\"\n".utf8)); exit(64) }
    let bytes = arguments[1].split(whereSeparator: { $0 == " " || $0 == "," }).compactMap { UInt8($0, radix: 16) }
    if let pen = onePen(bytes) { say(onePenLine(pen)) } else { say(["k": "not-a-one-pen-report"]) }
    exit(0)
}

if arguments.first == "--check-one-hover" {
    guard arguments.count == 3, let status = UInt8(arguments[1], radix: 16), let ageMs = Double(arguments[2]), ageMs >= 0 else {
        FileHandle.standardError.write(Data("usage: wm-pen --check-one-hover <status-hex> <report-age-ms>\n".utf8)); exit(64)
    }
    let valid = status & 0xC0 == 0xC0
    let hover = valid && status & 0x0F == 0
    say(["k": "hover-ready", "ready": currentCleanHover(hover, reportAt: -ageMs / 1000, now: 0)])
    exit(0)
}

if arguments.first == "--check-one-seize-timeout" {
    guard arguments.count == 4, let owned = Int(arguments[1]), ["true", "false"].contains(arguments[2]) else {
        FileHandle.standardError.write(Data("usage: wm-pen --check-one-seize-timeout <owned-count> <active:true|false> <start-age-ms|->\n".utf8)); exit(64)
    }
    let active = arguments[2] == "true"
    let ageMs: Double?
    if arguments[3] == "-" { ageMs = nil }
    else {
        guard let age = Double(arguments[3]), age >= 0 else {
            FileHandle.standardError.write(Data("usage: wm-pen --check-one-seize-timeout <owned-count> <active:true|false> <start-age-ms|->\n".utf8)); exit(64)
        }
        ageMs = age
    }
    say(["k": "seize-timeout", "expired": postSeizeExpired(ownedHandles: owned, active: active,
        startedAt: ageMs.map { -$0 / 1000 }, now: 0)])
    exit(0)
}

// The diagnostic is also covered by tests: only the latest recent report can authorize acquiring the pointer.

/// The vendor interface that carries a pen display's pen reports. Only the Wacom One 12's layout is decoded.
func buttonInterface() -> IOHIDDevice? {
    devices().first {
        penDisplayProducts.contains(number($0, kIOHIDProductIDKey))
            && number($0, kIOHIDPrimaryUsagePageKey) == 0xFFD1 && number($0, kIOHIDPrimaryUsageKey) == 0x300
    }
}

// `--capture-one` probes the two known 0x1e report-source interfaces without seizing, validates their traffic, then
// closes those clients and reacquires fresh clients for only the selected source, its known driver-visible sibling when
// needed, and this One's Mouse interface. It never opens every interface sharing a product ID.
final class OneCallbackContext {
    weak var reader: OneReader?
    var reports = 0
    var removals = 0
}

final class OneReader {
    let device: IOHIDDevice
    let role: String
    let buffer: UnsafeMutablePointer<UInt8>
    let size: Int
    let callbackContext = OneCallbackContext()
    weak var runtime: OneCaptureRuntime?
    var open = true
    var seized = false
    init(_ device: IOHIDDevice, role: String, seized: Bool = false) {
        self.device = device
        self.role = role
        self.seized = seized
        size = min(max(number(device, kIOHIDMaxInputReportSizeKey), 64), 256)
        buffer = .allocate(capacity: size)
        callbackContext.reader = self
    }
}

final class OneCaptureRuntime {
    let mouse: IOHIDDevice
    let seize = IOOptionBits(kIOHIDOptionsTypeSeizeDevice)
    let available: [String: IOHIDDevice]
    var selectedSourceRole: String?
    var readers: [OneReader] = []
    var retiredReaders: [OneReader] = []
    var held: [OneReader] = []
    var active = false
    var selecting = false
    var selectionStartedAt = ProcessInfo.processInfo.systemUptime
    var latestCleanHover: [String: Bool] = [:]
    var latestAtByRole: [String: Double] = [:]
    var latestValidAt = ProcessInfo.processInfo.systemUptime
    var postSeizeAt: Double?
    var lastInRange = false
    var lastHeartbeatAt = ProcessInfo.processInfo.systemUptime
    var unknownReports = 0
    var closing = false

    init(mouse: IOHIDDevice, available: [String: IOHIDDevice]) { self.mouse = mouse; self.available = available }

    func closeReader(_ reader: OneReader) {
        guard reader.open else { return }
        reader.open = false
        IOHIDDeviceUnscheduleFromRunLoop(reader.device, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)
        IOHIDDeviceClose(reader.device, reader.seized ? seize : IOOptionBits(kIOHIDOptionsTypeNone))
    }

    func add(_ device: IOHIDDevice, role: String, seized: Bool = false) -> Bool {
        let options = seized ? seize : IOOptionBits(kIOHIDOptionsTypeNone)
        let status = IOHIDDeviceOpen(device, options)
        guard status == kIOReturnSuccess else {
            log("Wacom One \(role) report source did not open: \(hex(status))")
            return false
        }
        let reader = OneReader(device, role: role, seized: seized)
        reader.runtime = self
        readers.append(reader)
        let context = Unmanaged.passUnretained(reader.callbackContext).toOpaque()
        IOHIDDeviceRegisterInputReportCallback(device, reader.buffer, reader.size, oneInputReportCallback, context)
        IOHIDDeviceRegisterRemovalCallback(device, oneRemovalCallback, context)
        IOHIDDeviceScheduleWithRunLoop(device, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)
        return true
    }

    func releaseAll() {
        guard !closing else { return }
        closing = true
        for reader in readers { closeReader(reader) }
        for reader in held { closeReader(reader) }
        held.removeAll()
    }

    func stop(_ why: String, code: Int32) -> Never {
        releaseAll()
        if active { say(["k": "closed", "why": why]) }
        else { say(["k": "refused", "why": why]) }
        exit(code)
    }

    private func freshClient(_ probe: IOHIDDevice, role: String) -> IOHIDDevice? {
        let service = IOHIDDeviceGetService(probe)
        guard service != MACH_PORT_NULL, let client = IOHIDDeviceCreate(kCFAllocatorDefault, service) else {
            log("could not recreate a fresh Wacom One \(role) HID client")
            return nil
        }
        guard number(client, kIOHIDVendorIDKey) == wacomVendor,
              number(client, kIOHIDProductIDKey) == 0x03CE else { return nil }
        let page = number(client, kIOHIDPrimaryUsagePageKey), usage = number(client, kIOHIDPrimaryUsageKey)
        let roleMatches = role == "mouse" ? (page == 1 && usage == 2)
            : role == "system-control" ? (page == 1 && usage == 0x80)
            : (page == 0xFFD1 && usage == 0x300)
        return roleMatches ? client : nil
    }

    func receive(_ source: OneReader, _ bytes: [UInt8]) {
        guard !closing, source.open else { return }
        if selectedSourceRole != nil {
            guard source.seized, held.contains(where: { $0 === source }) else { return }
        }
        guard bytes.first == 0x1E else {
            if !active && unknownReports < 8 { unknownReports += 1; say(["k": "raw", "source": source.role, "hex": hexLine(Array(bytes.prefix(32)))]) }
            return
        }
        guard let report = onePen(bytes) else {
            latestAtByRole[source.role] = ProcessInfo.processInfo.systemUptime
            latestCleanHover[source.role] = false
            if source.role == selectedSourceRole && (active || selecting || held.contains(where: { $0.role == source.role })) {
                stop("the Wacom One pen report no longer matches its captured descriptor", code: 5)
            }
            if unknownReports < 8 { unknownReports += 1; say(["k": "raw", "source": source.role, "hex": hexLine(Array(bytes.prefix(32)))]) }
            return
        }
        let now = ProcessInfo.processInfo.systemUptime
        latestAtByRole[source.role] = now
        latestCleanHover[source.role] = cleanHover(report)

        if cleanHover(report), selectedSourceRole == nil, !active, !selecting, held.isEmpty {
            DispatchQueue.main.async { [weak self] in self?.chooseValidatedSource() }
        }

        guard source.role == selectedSourceRole else { return }
        if !active {
            guard !selecting && held.contains(where: { $0.role == source.role }) else { return }
            active = true
            say(["k": "opened", "mode": "one", "source": source.role, "name": text(mouse, kIOHIDProductKey), "pid": 0x03CE])
        }
        latestValidAt = now
        lastInRange = (report.flags & 0x80) != 0
        say(onePenLine(report))
    }

    func beginSeize(_ sourceRole: String) {
        guard !selecting && !active && held.isEmpty && !closing else { return }
        guard let sourceProbe = available[sourceRole],
              currentCleanHover(latestCleanHover[sourceRole] ?? false, reportAt: latestAtByRole[sourceRole], now: ProcessInfo.processInfo.systemUptime) else { return }
        selecting = true
        selectedSourceRole = sourceRole
        for reader in readers { closeReader(reader); retiredReaders.append(reader) }
        readers.removeAll()

        var roles = [sourceRole]
        if sourceRole == "vendor", available["system-control"] != nil { roles.append("system-control") }
        roles.append("mouse")
        var fresh: [(String, IOHIDDevice)] = []
        for role in roles {
            let probe = role == "mouse" ? mouse : (available[role] ?? sourceProbe)
            guard let client = freshClient(probe, role: role) else { stop("the Wacom One \(role) interface could not be recreated", code: 2) }
            fresh.append((role, client))
        }

        for (role, client) in fresh where role != "mouse" {
            guard add(client, role: role, seized: true), let reader = readers.last else {
                stop("the Wacom One \(role) interface could not be seized", code: 2)
            }
            held.append(reader)
        }
        guard let (_, mouseClient) = fresh.first(where: { $0.0 == "mouse" }),
              add(mouseClient, role: "mouse", seized: true), let mouseReader = readers.last else {
            stop("the Wacom One Mouse interface could not be seized", code: 2)
        }
        held.append(mouseReader)
        selecting = false
        // Do not report opened until the selected seized source produces a fresh valid sample.
        postSeizeAt = ProcessInfo.processInfo.systemUptime
        lastInRange = false
    }

    func chooseValidatedSource() {
        guard !selecting && !active && held.isEmpty && !closing else { return }
        let now = ProcessInfo.processInfo.systemUptime
        let preferred = currentCleanHover(latestCleanHover["system-control"] ?? false,
                                           reportAt: latestAtByRole["system-control"], now: now)
        let fallback = currentCleanHover(latestCleanHover["vendor"] ?? false,
                                          reportAt: latestAtByRole["vendor"], now: now)
        if preferred, now - selectionStartedAt >= 0.15 {
            beginSeize("system-control")
        } else if fallback, now - selectionStartedAt >= 0.75,
                  latestAtByRole["system-control"] == nil {
            beginSeize("vendor")
        }
    }
}

func oneInputReportCallback(_ context: UnsafeMutableRawPointer?, _ result: IOReturn, _ sender: UnsafeMutableRawPointer?,
                            _ type: IOHIDReportType, _ reportID: UInt32, _ report: UnsafeMutablePointer<UInt8>, _ length: CFIndex) {
    guard let context else { return }
    let box = Unmanaged<OneCallbackContext>.fromOpaque(context).takeUnretainedValue()
    box.reports += 1
    guard let reader = box.reader else { return }
    reader.runtime?.receive(reader, Array(UnsafeBufferPointer(start: report, count: length)))
}

func oneRemovalCallback(_ context: UnsafeMutableRawPointer?, _ result: IOReturn, _ sender: UnsafeMutableRawPointer?) {
    guard let context else { return }
    let box = Unmanaged<OneCallbackContext>.fromOpaque(context).takeUnretainedValue()
    box.removals += 1
    guard let reader = box.reader, let runtime = reader.runtime else { return }
    runtime.closeReader(reader)
    if runtime.held.contains(where: { $0 === reader }) { runtime.stop("a Wacom One capture interface was unplugged", code: 5) }
    if runtime.readers.allSatisfy({ !$0.open }) { runtime.stop("the Wacom One pen report interfaces were unplugged", code: 5) }
}

func checkOneCallbackContext() -> [String: Int] {
    let context = OneCallbackContext()
    let sender = OneCallbackContext()
    let contextPointer = Unmanaged.passUnretained(context).toOpaque()
    let senderPointer = Unmanaged.passUnretained(sender).toOpaque()
    var report: [UInt8] = [0x1E, 0x01, 0xC0]
    report.withUnsafeMutableBufferPointer { bytes in
        oneInputReportCallback(contextPointer, kIOReturnSuccess, senderPointer, kIOHIDReportTypeInput, 0x1E,
                               bytes.baseAddress!, bytes.count)
    }
    oneRemovalCallback(contextPointer, kIOReturnSuccess, senderPointer)
    return ["contextReports": context.reports, "senderReports": sender.reports,
            "contextRemovals": context.removals, "senderRemovals": sender.removals]
}

if arguments.first == "--capture-one" {
    guard enableCaptureOutput() else {
        FileHandle.standardError.write(Data("could not enable nonblocking Wacom One output\n".utf8))
        exit(5)
    }
    let devicesForOne = devices().filter { number($0, kIOHIDProductIDKey) == 0x03CE }
    let mouseMatches = devicesForOne.filter {
        number($0, kIOHIDPrimaryUsagePageKey) == 1 && number($0, kIOHIDPrimaryUsageKey) == 2
    }
    guard mouseMatches.count == 1, let mouse = mouseMatches.first else {
        say(["k": "refused", "why": mouseMatches.isEmpty ? "the Wacom One pointer interface is unavailable" : "multiple Wacom One pointer interfaces are ambiguous"]); exit(4)
    }

    // Never raise a consent prompt from a background pad launch. The app reports this state for an explicit user action.
    let permission: String
    switch IOHIDCheckAccess(kIOHIDRequestTypeListenEvent) {
    case kIOHIDAccessTypeGranted: permission = "granted"
    case kIOHIDAccessTypeDenied: permission = "denied"
    default: permission = "undecided"
    }
    say(["k": "access", "v": permission])
    guard permission == "granted" else {
        say(["k": "refused", "why": "Input Monitoring is needed to keep the Wacom One pen from moving the system pointer", "permission": permission])
        exit(3)
    }

    say(["k": "device", "name": text(mouse, kIOHIDProductKey), "pid": 0x03CE,
         "maxX": 25632, "maxY": 14418, "maxP": 4095])

    let candidates: [(IOHIDDevice, String)] = devicesForOne.compactMap { device in
        let page = number(device, kIOHIDPrimaryUsagePageKey), usage = number(device, kIOHIDPrimaryUsageKey)
        if page == 1 && usage == 0x80 { return (device, "system-control") }
        if page == 0xFFD1 && usage == 0x300 { return (device, "vendor") }
        return nil
    }
    guard !candidates.isEmpty else { say(["k": "refused", "why": "the Wacom One pen report interface is unavailable"]); exit(4) }
    let roleCounts = Dictionary(grouping: candidates, by: { $0.1 }).mapValues(\.count)
    guard roleCounts.values.allSatisfy({ $0 == 1 }) else {
        say(["k": "refused", "why": "multiple Wacom One pen report interfaces are ambiguous"]); exit(4)
    }

    let available = Dictionary(candidates.map { ($0.1, $0.0) }, uniquingKeysWith: { first, _ in first })
    let runtime = OneCaptureRuntime(mouse: mouse, available: available)
    captureOutputFailureHandler = { runtime.stop("the Wacom One output pipe stopped draining", code: 5) }
    for (device, role) in candidates { _ = runtime.add(device, role: role) }
    guard !runtime.readers.isEmpty else { say(["k": "refused", "why": "no Wacom One pen report source could be opened"]); exit(4) }

    var stdinBuffer = ""
    signal(SIGTERM, SIG_IGN); signal(SIGINT, SIG_IGN)
    let terminate = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    terminate.setEventHandler { runtime.stop("capture stopped", code: 0) }; terminate.resume()
    let interrupt = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
    interrupt.setEventHandler { runtime.stop("capture stopped", code: 0) }; interrupt.resume()
    let input = DispatchSource.makeReadSource(fileDescriptor: STDIN_FILENO, queue: .main)
    input.setEventHandler {
        var chunk = [UInt8](repeating: 0, count: 256)
        let readCount = read(STDIN_FILENO, &chunk, chunk.count)
        guard readCount > 0 else { runtime.stop("controller closed its lease", code: 0) }
        stdinBuffer += String(decoding: chunk.prefix(readCount), as: UTF8.self)
        while let end = stdinBuffer.firstIndex(of: "\n") {
            let line = String(stdinBuffer[..<end])
            stdinBuffer.removeSubrange(...end)
            if line == "ping" { runtime.lastHeartbeatAt = ProcessInfo.processInfo.systemUptime }
        }
    }
    input.resume()
    let watchdog = DispatchSource.makeTimerSource(queue: .main)
    watchdog.schedule(deadline: .now() + .milliseconds(250), repeating: .milliseconds(250), leeway: .milliseconds(50))
    watchdog.setEventHandler {
        let now = ProcessInfo.processInfo.systemUptime
        if now - runtime.lastHeartbeatAt > 2 { runtime.stop("controller heartbeat expired", code: 0) }
        if runtime.active && runtime.lastInRange && now - runtime.latestValidAt > 0.75 { runtime.stop("the in-range Wacom One stream stopped", code: 5) }
        if postSeizeExpired(ownedHandles: runtime.held.count, active: runtime.active, startedAt: runtime.postSeizeAt, now: now) {
            runtime.stop("the seized Wacom One stream did not resume", code: 5)
        }
        runtime.chooseValidatedSource()
    }
    watchdog.resume()
    say(["k": "listening", "name": text(mouse, kIOHIDProductKey), "pid": 0x03CE])
    CFRunLoopRun()
    exit(0)
}

// The vendor interface can be silent (macOS 27 with the Wacom driver running): the pen's standard interface, which the driver
// reads too, carries the same switches and the pen's position. It is read without seizing: the driver keeps the pointer, and a
// touch made with a side button held is placed by the display's own report, whatever the driver makes of that button.
var standardReports = PassiveReports(contactPosition: true)
var standardDevice: IOHIDDevice?
var standardRefused: IOReturn = 0
var standardUnknown = 0
let standardBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 512)

func standardPenInterface() -> IOHIDDevice? {
    devices().first { device in
        guard penDisplayProducts.contains(number(device, kIOHIDProductIDKey)),
              let pairs = IOHIDDeviceGetProperty(device, kIOHIDDeviceUsagePairsKey as CFString) as? [[String: Any]] else { return false }
        return pairs.contains { ($0[kIOHIDDeviceUsagePageKey] as? Int) == 0x0D && ($0[kIOHIDDeviceUsageKey] as? Int) == 0x02 }
    }
}

func closeStandard() {
    guard let device = standardDevice else { return }
    standardDevice = nil
    IOHIDDeviceUnscheduleFromRunLoop(device, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)
    IOHIDDeviceClose(device, IOOptionBits(kIOHIDOptionsTypeNone))
    if standardReports.side != Side() { say(sideLine(Side())) }
    standardReports = PassiveReports(contactPosition: true)
}

func openStandard() {
    guard standardDevice == nil, let device = standardPenInterface() else { return }
    let status = IOHIDDeviceOpen(device, IOOptionBits(kIOHIDOptionsTypeNone))
    if status != kIOReturnSuccess {
        if status != standardRefused { standardRefused = status; log("the pen display's pen interface did not open: \(hex(status))") }
        return
    }
    standardRefused = 0
    standardDevice = device
    IOHIDDeviceRegisterInputReportCallback(device, standardBuffer, 512, { _, _, _, _, _, report, length in
        let bytes = Array(UnsafeBufferPointer(start: report, count: length))
        if !standardReports.read(bytes, emit: say) && standardUnknown < 8 {
            standardUnknown += 1
            say(["k": "raw", "hex": hexLine(Array(bytes.prefix(32)))])
        }
    }, nil)
    IOHIDDeviceRegisterRemovalCallback(device, { _, _, _ in closeStandard() }, nil)
    IOHIDDeviceScheduleWithRunLoop(device, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)
    // This interface is the one that reports: tell the app a pen display is here, with its contact positions.
    say(["k": "opened", "mode": "buttons", "name": text(device, kIOHIDProductKey), "pid": number(device, kIOHIDProductIDKey), "contactPosition": true])
    log("reading the pen display's standard pen reports")
}

var passiveReports = PassiveReports(contactPosition: false)
var sideUnknown = 0
var sideDevice: IOHIDDevice?
var sideRefused: IOReturn = 0
let sideBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 256)

func closeButtons(_ why: String) {
    guard let device = sideDevice else { closeStandard(); return }
    sideDevice = nil
    IOHIDDeviceUnscheduleFromRunLoop(device, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)
    IOHIDDeviceClose(device, IOOptionBits(kIOHIDOptionsTypeNone))
    // The buttons are not held by a display that is gone.
    if passiveReports.side != Side() { say(sideLine(Side())) }
    passiveReports = PassiveReports(contactPosition: false)
    closeStandard()
    say(["k": "closed", "why": why])
}

func openButtons() {
    guard sideDevice == nil, let device = buttonInterface() else { return }
    // No seize: the driver and the system keep the pen, and this asks for no Input Monitoring.
    let status = IOHIDDeviceOpen(device, IOOptionBits(kIOHIDOptionsTypeNone))
    if status != kIOReturnSuccess {
        if status != sideRefused { sideRefused = status; log("the pen display's vendor interface did not open: \(hex(status))") }
        return
    }
    sideRefused = 0
    sideDevice = device
    let pid = number(device, kIOHIDProductIDKey)
    passiveReports = PassiveReports(contactPosition: pid == 0x03CE)
    IOHIDDeviceRegisterInputReportCallback(device, sideBuffer, 256, { _, _, _, _, _, report, length in
        let bytes = Array(UnsafeBufferPointer(start: report, count: length))
        if !passiveReports.read(bytes, emit: say) && sideUnknown < 8 {
            sideUnknown += 1
            say(["k": "raw", "hex": hexLine(Array(bytes.prefix(32)))])
        }
    }, nil)
    IOHIDDeviceRegisterRemovalCallback(device, { _, _, _ in closeButtons("the display was unplugged") }, nil)
    IOHIDDeviceScheduleWithRunLoop(device, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)
    say(["k": "opened", "mode": "buttons", "name": text(device, kIOHIDProductKey), "pid": pid, "contactPosition": passiveReports.contactPosition])
}

if arguments.first == "--buttons" {
    func leave() -> Never { closeButtons("quit"); exit(0) }
    signal(SIGTERM, SIG_IGN); signal(SIGINT, SIG_IGN)
    let terminate = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    terminate.setEventHandler { leave() }; terminate.resume()
    let interrupt = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
    interrupt.setEventHandler { leave() }; interrupt.resume()
    let stdinClosed = DispatchSource.makeReadSource(fileDescriptor: STDIN_FILENO, queue: .main)
    stdinClosed.setEventHandler {
        var buffer = [UInt8](repeating: 0, count: 256)
        if read(STDIN_FILENO, &buffer, buffer.count) <= 0 { leave() }
    }
    stdinClosed.resume()
    openButtons()
    openStandard()
    // A display plugged in later (or one whose interface was not ready yet) is found within a couple of seconds.
    let watch = Timer(timeInterval: 2, repeats: true) { _ in openButtons(); openStandard() }
    RunLoop.main.add(watch, forMode: .common)
    CFRunLoopRun()
    exit(0)
}

let seen = devices()
var all = seen.filter { verdictOf($0) == .take }
// Two different tablets at once: the one whose report 2 has absolute X/Y goes first, then the pointer class (devices() put that first).
if Set(all.map { number($0, kIOHIDProductIDKey) }).count > 1 {
    all = all.enumerated().sorted { a, b in
        let sa = hasAbsoluteXY(a.element), sb = hasAbsoluteXY(b.element)
        return sa != sb ? sa : a.offset < b.offset
    }.map { $0.element }
}
guard let pointer = all.first else {
    if seen.contains(where: { verdictOf($0) == .penDisplay }) {
        say(["k": "refused", "why": "a pen display draws by itself", "penDisplay": true])
        exit(6)
    }
    say(["k": "refused", "why": "no Wacom tablet is plugged in"])
    exit(4)
}

// Generic tablet capture asks only once there is a tablet to take.
var answer = access()
if answer == "undecided" {
    answer = IOHIDRequestAccess(kIOHIDRequestTypeListenEvent) ? "granted" : access()
}
say(["k": "access", "v": answer])
if answer != "granted" { exit(3) }

let productID = number(pointer, kIOHIDProductIDKey)
let mine = all.filter { number($0, kIOHIDProductIDKey) == productID }
// The One by Wacom small (CTL-472) as the Swift app measured it, when the descriptor says nothing usable.
let knownX = 15200, knownY = 9500
let maxX = logicalMax(pointer, page: 1, usage: 0x30), maxY = logicalMax(pointer, page: 1, usage: 0x31)
let maxP = logicalMax(pointer, page: 0x0D, usage: 0x30)
say(["k": "device", "name": text(pointer, kIOHIDProductKey).isEmpty ? "Wacom tablet" : text(pointer, kIOHIDProductKey),
     "pid": productID, "maxX": maxX > 1000 && maxX < 65536 ? maxX : knownX, "maxY": maxY > 1000 && maxY < 65536 ? maxY : knownY, "maxP": maxP > 0 ? maxP : 2047])

// ---- seize

final class Held {
    let device: IOHIDDevice
    let buffer: UnsafeMutablePointer<UInt8>
    let size: Int
    var modeBefore: UInt8?
    init(_ device: IOHIDDevice, size: Int) { self.device = device; self.size = size; buffer = .allocate(capacity: size) }
}
var held: [Held] = []
let seize = IOOptionBits(kIOHIDOptionsTypeSeizeDevice)
let modeReport: UInt8 = 2, penMode: UInt8 = 2
var unknown = 0

for device in mine {
    let status = IOHIDDeviceOpen(device, seize)
    log("HID usage page 0x\(String(number(device, kIOHIDPrimaryUsagePageKey), radix: 16)) usage 0x\(String(number(device, kIOHIDPrimaryUsageKey), radix: 16)) seized: \(hex(status))")
    if status == kIOReturnSuccess {
        held.append(Held(device, size: max(number(device, kIOHIDMaxInputReportSizeKey), 64)))
    } else if status == kIOReturnExclusiveAccess {
        IOHIDDeviceClose(device, seize)
    }
}
let pointerHeld = held.contains { $0.device === pointer }
if !pointerHeld {
    for one in held { IOHIDDeviceClose(one.device, seize) }
    say(["k": "refused", "why": "the tablet could not be taken from the Wacom driver (another app may hold it)"])
    exit(2)
}

func release() {
    for one in held {
        if let before = one.modeBefore {
            let back = [modeReport, before]
            _ = IOHIDDeviceSetReport(one.device, kIOHIDReportTypeFeature, CFIndex(modeReport), back, back.count)
        }
        IOHIDDeviceClose(one.device, seize)
    }
    held = []
}

// With no driver the tablet is a plain mouse until told to send pen reports: read the mode, set the pen's if it is not.
for one in held where one.device === pointer {
    var now = [UInt8](repeating: 0, count: 2)
    var length = CFIndex(now.count)
    let read = IOHIDDeviceGetReport(one.device, kIOHIDReportTypeFeature, CFIndex(modeReport), &now, &length)
    let was: UInt8? = read == kIOReturnSuccess && length >= 2 ? now[1] : nil
    if was != penMode {
        let wanted = [modeReport, penMode]
        let set = IOHIDDeviceSetReport(one.device, kIOHIDReportTypeFeature, CFIndex(modeReport), wanted, wanted.count)
        log("mode report \(was.map { String($0) } ?? "unread") set to \(penMode): \(hex(set))")
        if set == kIOReturnSuccess { one.modeBefore = was }
    }
}

for one in held {
    IOHIDDeviceRegisterInputReportCallback(one.device, one.buffer, one.size, { _, _, _, _, _, report, length in
        let bytes = UnsafeBufferPointer(start: report, count: length)
        if length == 10 && bytes[0] == 2 {
            say(["k": "p", "f": Int(bytes[1]),
                 "x": Int(bytes[2]) | Int(bytes[3]) << 8,
                 "y": Int(bytes[4]) | Int(bytes[5]) << 8,
                 "p": Int(bytes[6]) | Int(bytes[7]) << 8])
        } else if unknown < 8 {
            unknown += 1
            say(["k": "raw", "hex": bytes.map { String(format: "%02x", $0) }.joined(separator: " ")])
        }
    }, nil)
    IOHIDDeviceScheduleWithRunLoop(one.device, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)
}
say(["k": "opened"])

// ---- the way out: stdin closing (NoteMind gone or done), SIGTERM, SIGINT, or the tablet unplugged

func quit() -> Never { release(); exit(0) }
signal(SIGTERM, SIG_IGN); signal(SIGINT, SIG_IGN)
let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
term.setEventHandler { quit() }; term.resume()
let int = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
int.setEventHandler { quit() }; int.resume()
let input = DispatchSource.makeReadSource(fileDescriptor: STDIN_FILENO, queue: .main)
input.setEventHandler {
    var buffer = [UInt8](repeating: 0, count: 256)
    if read(STDIN_FILENO, &buffer, buffer.count) <= 0 { quit() }
}
input.resume()
IOHIDDeviceRegisterRemovalCallback(pointer, { _, _, _ in
    say(["k": "refused", "why": "the tablet was unplugged"])
    release(); exit(5)
}, nil)
CFRunLoopRun()
