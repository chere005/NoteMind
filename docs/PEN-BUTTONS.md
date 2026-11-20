# Drawing pen buttons

Button names refer to the physical switches. **Lower** means nearer the tip. **Upper** means farther from the tip.

| Button | Hold the button and use the tip on the sheet | Double-tap the button while hovering |
| --- | --- | --- |
| Lower | Tap a stroke or drag across strokes to erase them. | Undo one Drawing edit. |
| Upper | Tap a stroke to select it. Drag a box to select several strokes. Drag inside an existing selection to move it. | Redo one Drawing edit. |

The active toolbar tool resumes after the gesture. Use **Drawing → Tablet Settings** to change the Hold and Double-tap assignments.

For a double-tap, press and release the same button twice with the tip in the air. The second press must start within 400 ms of the first release. Each press can last up to 500 ms. The action runs on the second release. Touching the sheet, switching buttons during a press, or overlapping the two buttons cancels the pair. A brief proximity gap between two completed presses is allowed on the passive Wacom feed if the presses meet the same timing limits.

## Input paths

On a supported Wacom One 12, NoteMind can read the physical switches and contact coordinates even when the Wacom driver translates a button into Pan/Scroll. That path carries ordinary tip strokes, pressure, and both held-button gestures. The drawing surface under the initial contact owns the gesture through the tip lift. An accepted driver gesture can finish on its original input path. For devices that expose only driver clicks, NoteMind interprets the Right Click and Middle Click events as Lower and Upper respectively.

## Regression tests

`npm test` checks the physical mapping, tap timing and cancellation, saved assignments, and contact routing without a device. With the macOS helper built, it also replays raw Wacom reports for a normal stroke, Lower erase, and Upper select through the production decoder. `test/pad-app.cjs` exercises the app and its mocked Wacom window together, including pressure, stroke erasure, selection by tap and drag, Undo and Redo, and the driver's duplicate events.
