# Continuation

- NoteMind 0.16.0 uses `.nm` for new Notepads and drawings; existing `.wm` archives remain readable. Projects use `.wmpr`.
- Graphics panes store one image preview and compact editable stroke sidecars; see GRAPHICS-PANES.md. Pen, mouse, selection transforms, native button actions and drawing-location switching have hidden application coverage.
- Committed ink is immutable. Drawing paints new segments, eraser queries cache stroke bounds, selection drags reuse bitmaps, and dirty-state checks reuse stroke fingerprints. Image previews reuse binary URLs and defer offscreen decoding.
- The large-document check uses 10,000 strokes, 200,000 points and 100 large images; it verifies incremental drawing, cached dragging, compact preview markup and complete autosave.
- `npm run preflight` runs the Node suite. `node test/validate-round.cjs source` and `node test/validate-round.cjs packaged` run hidden application checks; the portable executable check runs on Windows.
- `npm run build` creates the Apple Silicon application at `dist/NoteMind/NoteMind.app`, locally signed without notarization. Physical Wacom behavior and Windows packaging still require their respective hardware.
