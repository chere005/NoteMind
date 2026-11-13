# Continuation

- NoteMind 0.19.0 uses `.nm` for new Notepads and drawings; existing `.wm` archives remain readable. Projects use `.wmpr`.
- Graphics panes store one image preview and compact editable stroke sidecars; see GRAPHICS-PANES.md. Pen, mouse, selection transforms, native button actions and drawing-location switching have hidden application coverage.
- Committed ink is immutable. Drawing paints new segments, eraser queries cache stroke bounds, selection drags reuse bitmaps, and dirty-state checks reuse stroke fingerprints. Image previews reuse binary URLs and defer offscreen decoding.
- The large-document check uses 10,000 strokes, 200,000 points and 100 large images; it verifies incremental drawing, cached dragging, compact preview markup and complete autosave.
- The workspace adapts to narrow windows, remembers sidebar resizing and visibility, keeps active tabs visible and avoids rebuilding navigation while typing. Lists, Insert and Format hold writing actions; source selection belongs to the capture pane. Drawing location and orientation are icon controls.
- Shared menus use their triggering window, keep live settings current, clamp and scroll within the viewport, and support submenu arrows, type-ahead, Escape and focus restoration. Hidden menu-audit and pen-display checks cover main-window and Wacom popups.
- `npm run preflight` runs the Node suite. `node test/validate-round.cjs source` and `node test/validate-round.cjs packaged` run hidden application checks; the portable executable check runs on Windows.
- `npm run build` creates the Apple Silicon application at `dist/NoteMind/NoteMind.app`, locally signed without notarization. Physical Wacom behavior and Windows packaging still require their respective hardware.
