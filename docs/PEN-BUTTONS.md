# Pen buttons

**This is a fixed contract. It must never break.** Sean set this behaviour and confirmed it (2026-11-20). Change it only on Sean's explicit word, and then change this page and the tests below in the same commit.

The pen has two side buttons:

- **Lower** (bottom): the button nearer the tip. It is the display's lower switch, DOM `buttons` bit 2.
- **Upper** (top): the button farther from the tip. It is the upper switch, bit 4.

## What the buttons do

| Do this | It does this |
| --- | --- |
| **Lower held, tip taps or drags** | **Delete:** erases the whole strokes the tip touches. |
| **Lower double-tap** | **Undo** |
| **Upper held, tip taps or drags** | **Selection box.** A tap selects the stroke under the tip. |
| **Upper double-tap** | **Redo** |
| **Lower tapped, then upper held, tip drags** | **Zoom** around where the tip touched: drag up to zoom in, down to zoom out. |
| **Upper tapped, then lower held, tip drags** | **Scroll:** pans the page. It only does something when the page is zoomed in. |

**Holding a button alone does nothing.** Nothing is deleted, selected, zoomed or scrolled until the tip touches.

**A held button is a mode until it is let go.** Every tap or drag deletes, selects, zooms or scrolls until that button comes up. Zoom and scroll last while their second button is held, across the tip's lifts between drags.

## The tests that hold it

Every `npm test`, and so every release, runs these:

| Test | What it checks |
| --- | --- |
| `test/pen-buttons-contract.test.cjs` | Every row above, as button and tip events through the real state machine and press rules. |
| `test/pen-buttons-app.test.cjs` | The same gestures on a real drawing sheet in the app, hidden (`test/pen-buttons-app.cjs`). |
| `test/pen-buttons-native.test.cjs` | The same gestures as the Wacom One 12 delivers them, hidden (`test/pen-buttons-native.cjs`). This means the display's own button reports and contact points, with the driver's Right Click and Pan/Scroll events played beside them. |
| `test/pen-contract-doc.test.cjs` | This page still states the contract, and the tests above still exist and check every step. |

Behind them, `npm test` also checks:
- the saved assignments, contact routing and tap timing (`pen-button-parity`, `pen-action-owner`, `pen-contact-drawing`, `pen-display`);
- the mocked Wacom window with pressure, erase, selection, Undo and Redo (`test/pad-app.cjs`).

## Rules that go with them

- **A held button does nothing until the tip touches.** Hovering with a button held erases nothing, selects nothing, zooms and scrolls nothing.
- **Double-tap** is two presses and releases of the same button in the air: each press at most 500 ms, the second starting at most 400 ms after the first ended. A tip touch anywhere in between, or a different button, ends it.
- **Chord** is one clean tap of one button (in the air, at most 500 ms), then the other button pressed in the air at most 400 ms after that tap ended. It lasts while the second button is held, across the tip's lifts between drags. Letting go of the second button ends it and the pen is back to the tool it had.
- Both buttons pressed at the same moment are not a chord. Pressing the second button with the tip already touching is a hold, not a chord. A chord's own presses never count as taps, so a chord never leaves half a double-tap behind.
- A button pressed or let go while a normal stroke is being drawn changes nothing about that stroke.
- The tool chosen on the toolbar resumes when the gesture ends. A hold erases by tap or by dragging across strokes; the top button's hold also drags a selection that already exists.
- A double-tap's action runs on the second release. Touching the sheet, switching buttons during a press, or overlapping the two buttons cancels the pair. A brief proximity gap between two completed presses is allowed on the passive Wacom feed, within the same timings.
- The eraser end of a pen (when a pen has one) erases while it touches.
- The jobs come from the saved button settings, which default to the table above. **Drawing, Tablet Settings…** in the menu bar, or **Pen Buttons…** in the pen's ▾ menu on the drawing bar, shows them and has **Standard buttons**, which puts every button back.

## Input paths

On a supported Wacom One 12, NoteMind reads the physical switches and the contact coordinates itself, from the pen report the display sends to the Wacom driver (report ID 6). A touch made with a side button held (or a chord) is placed by the display alone, its tip and its position, whatever the driver makes of that button: Right Click (a press that can carry pressure while the pen only hovers) or Pan/Scroll (the pointer frozen where the button went down, the movement turned into a wheel). None of the driver's events for it starts anything on the sheet, and the sheet shows no pointer while a side button is held. Plain writing stays the driver's. The drawing surface under the first contact owns a gesture until the tip lifts. For devices that give only driver clicks, Right Click is read as the bottom button and Middle Click as the top button.

## macOS permission

The helper that reads the display's buttons needs **Input Monitoring** for NoteMind (System Settings, Privacy & Security). With a Wacom display attached the app asks macOS at startup, logs the answer in `startup.log` (`input monitoring: granted` or `denied`), asks once whether to open the setting when it is not granted, and starts the button reader over by itself when it is. macOS 27.2 (November 2026) is where this became necessary. If the app's own entry looks on but the answer stays `denied`, remove NoteMind from the list with the minus button and add it back.

## Reading what a real pen did

`pen.log` (the app's data folder) has a `buttons` line for every report the display's helper delivers (tip, bottom, top, in range) and a `contact-dropped` line when a touch could not be used. `startup.log` has `[pen]` lines for what the runtime decided: `native` (a button changed, and whether button gestures were allowed), `chord`, `double-tap`, `press` (what a touch with a button held became), `gesture` (what the sheet started for it, and whether the display placed it), and `driver` (each press, release and change of buttons the Wacom driver itself sent while the display's pen was in play). Gestures that do nothing on a real pen can be read from these.

## Where it lives

| What | Where |
|---|---|
| Which switch is which and where the pen touches (display report byte 2: `0x02` bottom, `0x04` top, `0x01` tip; read from the pen's standard report ID 6, which the Wacom driver reads and which keeps flowing when the vendor stream is silent, X/Y/pressure at bytes 3/6/9; and from the vendor interface's report `0x1E`) | `tools/pen/wm-pen-display.swift` (`sideState`), `src/tablet/main/pen/macPenBackend.ts` |
| The DOM button masks, native overlay | `src/tablet/renderer/penButtons.ts` (`withNative`, `slotOf`, `inContact`), `nativeButtons.ts` |
| Default jobs, saved settings and their migration | `penButtons.ts` (`DEFAULT_BUTTONS`, `migrateButtons`), `penSettings.ts` |
| Double-tap and chord state machine (pure) | `penButtons.ts` (`tapStep`) |
| What a press means (hold jobs, chord override) | `penButtons.ts` (`resolvePress`), `penChord.ts` |
| Feeding events to the state machine, driver echo guard | `penActions.ts` |
| Erase, select, pan and zoom on the sheet | `TabletSurface.tsx`, `usePrecisionView.ts` (`beginPan`, `beginZoom`) |
