# Pen buttons

The pen has two side buttons. **Bottom** is the one nearer the tip (the display's lower switch, DOM `buttons` bit 2).
**Top** is the one farther from the tip (the upper switch, bit 4).

This behaviour is fixed by the owner. It must never break, and it is checked on every run of `npm test`:

- `test/pen-buttons-contract.test.cjs`: every row below, as button and tip events through the real state machine and press rules.
- `test/pen-buttons-app.test.cjs`: the same gestures on a real drawing sheet in the app, hidden (`test/pen-buttons-app.cjs`).
- Behind them, `npm test` also checks the saved assignments, contact routing and tap timing (`pen-button-parity`, `pen-action-owner`, `pen-contact-drawing`, `pen-display`), and `test/pad-app.cjs` runs the mocked Wacom window with pressure, erase, selection, Undo and Redo.

Changing a row needs the owner's explicit word, and this file and both tests change in the same commit.

## What the buttons do

| Gesture | Result |
|---|---|
| Bottom button held, tip touches (tap or drag) | Delete: erases whole strokes under the tip. |
| Bottom button double-tap | Undo. |
| Top button held, tip touches and drags | Selection box (a tap selects the stroke under the tip). |
| Top button double-tap | Redo. |
| Bottom button tapped, then top button pressed and held, quickly | Zoom: the tip touches and drags up to zoom in, down to zoom out, around where it touched. |
| Top button tapped, then bottom button pressed and held, quickly | Scroll: the tip touches and drags to pan the page. Only does anything when the page is zoomed in. |

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

On a supported Wacom One 12, NoteMind reads the physical switches and the contact coordinates itself, even when the Wacom driver turns a button into Pan/Scroll: tip strokes, pressure and every gesture above come from that path. The drawing surface under the first contact owns a gesture until the tip lifts. For devices that give only driver clicks, Right Click is read as the bottom button and Middle Click as the top button.

## Where it lives

| What | Where |
|---|---|
| Which switch is which (display report byte 2: `0x02` bottom, `0x04` top) | `tools/pen/wm-pen-display.swift` (`sideState`), `src/tablet/main/pen/macPenBackend.ts` |
| The DOM button masks, native overlay | `src/tablet/renderer/penButtons.ts` (`withNative`, `slotOf`, `inContact`), `nativeButtons.ts` |
| Default jobs, saved settings and their migration | `penButtons.ts` (`DEFAULT_BUTTONS`, `migrateButtons`), `penSettings.ts` |
| Double-tap and chord state machine (pure) | `penButtons.ts` (`tapStep`) |
| What a press means (hold jobs, chord override) | `penButtons.ts` (`resolvePress`), `penChord.ts` |
| Feeding events to the state machine, driver echo guard | `penActions.ts` |
| Erase, select, pan and zoom on the sheet | `TabletSurface.tsx`, `usePrecisionView.ts` (`beginPan`, `beginZoom`) |
