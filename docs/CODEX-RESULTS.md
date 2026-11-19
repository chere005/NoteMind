# Requested UI fixes — 2026-11-18
- Moved Rendered between Notepad options and Capture; all three use aligned 28 px buttons.
- Image insertion reuses the empty caret paragraph; adjacent image-only paragraphs have a 4 px gap.
- Drawing copy/paste preserves editable strokes, pressure, proportions, original size and one-step Undo.
- Pasted clipboard images open as their own drawable sheets, preserving existing sheet contents.
- Selection actions use full-size controls over the main-window Wacom mirror; pen-window controls are larger too.
- Save / Don’t Save / Cancel follows the window where the drawing tab was closed, with owner-window fallback.
- Validation: tablet bundle rebuilt; final broad suite 3,433 passed / 0 failed / 2 skipped; final focused suite 38 passed.
- Native Electron launch exits SIGABRT here; the instance-window test was skipped on the final run. No installer, merge or install.
