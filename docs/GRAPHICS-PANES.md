# Graphics panes

A graphics pane is a block in a Notepad. Incoming drawing and camera captures always create a pane on its own line; they never create an inline graphic.

Markdown keeps a normal image reference, `![Drawing](assets/<id>.svg)`, so previews work in exports and other readers. An optional adjacent `<image-name>.json` asset holds editable strokes. Notepad metadata marks the image as a graphics pane. A picture without strokes opens as a background with an empty ink layer.

The JSON has `format: "notemind-graphics"`, `version: 1`, `name`, `aspect` (width / height), optional `paper` and `backdrop`, and `strokes`. Each stroke is `[colour, width, coordinates, pressures?]`. Coordinates are a flat `[x, y, x, y, ...]` array of normalized points; widths use a 1000-unit reference width. Optional pressures have one number per point. No per-point objects or duplicated history are stored. The Notepad ZIP compresses the data. Each preview loads as one image; the middle editor does not create a DOM element for every stroke.

Choose **Edit in Wacom** on a pane, or **Edit with Tablet** in its context menu. The editor loads its editable strokes and background. **Update** (the primary Save to Original action) replaces that pane's preview and stroke data as one undoable Notepad change. Closing the original Notepad prevents replacement. Bringing the drawing in separately creates an independent pane.

The drawing bar has Pen, Eraser and Select tools, colour swatches and a width dropdown. Mouse and pen both follow the selected tool; held pen buttons override it. The lower button erases complete strokes and double-taps Undo; the upper button selects while held and dragged and double-taps Redo. In Select mode, drag a box around complete strokes, then drag inside it to move those strokes. Corner handles resize selected ink. Strokes crossing the box stay unchanged. A move or resize is one Undo; cancellation restores the starting ink. Clear Sheet has its own button and is undoable.

Readers reject unsupported versions, invalid numeric data, mismatched pressure arrays and excessive point counts. Saving, autosave, Notepad undo, archive checksums and Markdown sidecars preserve both the preview and the editable data.

The drawing-location icon toggles In this window or Wacom screen. The Wacom pane covers the entire extended display, including the menu and Dock area. Only an extended Wacom display can own a separate pane; a mirrored screen draws directly in the application window. The location is remembered and switching retains sheets, strokes and selections.

Committed strokes and their points are immutable. New samples paint incrementally; selection drags reuse bitmap layers and transform vector coordinates once on release. Stroke bounds and dirty-state fingerprints are cached. The editor keeps binary image URLs outside its markup and defers offscreen image decoding.

Use the orientation icon beside Paper to turn a normal sheet between landscape, portrait and their reversed orientations. Imported pictures retain their original aspect ratio while pen mapping follows the selected orientation.

The capture source menu switches Drawing, Camera and Document without closing their pages. Drawing options holds Save Drawing As, Open Drawing and project copies. Camera options retains rotation and ink actions when the pane is narrow; Insert names the capture format.
