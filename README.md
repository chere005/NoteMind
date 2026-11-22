# NoteMind

A desktop Notepad application with a visual/Markdown editor, a folder and project sidebar, and integrated drawing and camera panes. The sidebar can be resized and adapts to small windows; Lists, Insert and Format group writing actions; the capture pane owns its source and device menu.

## Run

Install Node.js and Python, then `npm install`, `npm run build`, and `npm start`.

The portable Windows application is `dist/NoteMind/NoteMind.exe`. On Linux, launch `dist/NoteMind/NoteMind` and keep the generated runtime files alongside it. On Apple Silicon macOS the build creates `dist/NoteMind/NoteMind.app`, signed locally for this machine; it is not notarized for distribution.

The app logo lives in `assets/logo.svg`. The build renders its master PNG and platform icons from that source, using the same monoline style as CalMind and PlanMind.

## Included

- Projects: a name plus files and folders, kept in a `.wmpr` file that saves itself on every change and opens in its own window, with a Default Workspace, twelve recent files and twelve recent projects, rename by file, and Undo for adding or removing a project's files and folders. Older `.wm` workspace files convert to `.wmpr` when opened. Older projects kept only in the local registry become project files in Documents/NoteMind Projects. Folder and file links, hidden sections, content search, live folder refresh, drag reordering and moving, rename, duplicate, Trash, and file-operation undo/redo.
- Document tabs, close/reopen, reordering, session restoration, resizable panes, and input-only layout.
- A footer with the word count of visible words, last-saved time and a 50–200% page zoom that is remembered. Autosave with external-change protection, recoverable drafts, automatic titles, and a global Ctrl+Alt+N quick-note shortcut.
- A text style picker in both editing modes: Body, Heading 1–6, Quote, Code Block, Bulleted List, Numbered List, and Checklist. Highlights, collapsible headings, document undo/redo, and find within the current Notepad.
- Editing keys through one shortcut table and a Format menu: Ctrl+B/I/U, Ctrl+Shift+X, Ctrl+1–6 headings, Ctrl+7 body, Ctrl+Q quote, Ctrl+8 code block, Ctrl+Shift+L list, Ctrl+]/[; underline, strikethrough and inline code on the toolbar. Run Python is F5.
- Find and Replace as a floating card (match case, whole word, Replace All as one Undo, F3, Ctrl+H, Use Selection for Find). Move Section Up/Down, collapse and expand all headings, quote continuation, and auto-pairing in code blocks.
- Paste of an HTML-only clipboard becomes Markdown, a pasted or dropped picture is added to the Notepad, dropped Notepads and documents open, and the context menus have Cut, Copy, Paste, Select All and spelling suggestions.
- File → Open Recent and Projects → Open Recent, tab-wheel switching, the file actions in the tab menu, and each tab reopening at the same words.
- File → Export → Export as PDF… with a first-page preview: A4 or Letter, orientation, margins, page numbers and picture-background removal. F1 lists every shortcut from the real menu; Help → Quick Reference is a Notepad that is rewritten when the app is newer.
- Notes-style tables: immediate 2×2 insertion, row/column handles, add/delete/reorder, inline formatting, HTML and tab-separated copy/paste, and text conversion. Tab moves across entries; Return moves down; Shift+Return inserts a line break; Escape exits the table. Drag a handle to reorder, or use its menu. Delete clears a selected row/column before removing it on the next press.
- Pinned Notepads, tags, saved smart filters, title/date sorting, links between Notepads, persistent Recently Deleted, and version preview/restoration.
- Select an embedded picture for resize and rotate controls, or use its context menu to crop it. Edits make a new picture, so other uses of the original stay unchanged and the edit can be undone.
- Embedded file attachments, inline PDF previews, an attachment browser, and multipage scans assembled from kept camera pages or pictures. Image and handwriting text is indexed offline for search.
- An extended Wacom display can show the drawing pane while its interactive mirror remains in the main window. The drawing-location icon switches between this window and the whole extended Wacom display. The right pane keeps full-size live controls and fits only the shared page. New drawing pages use A5 proportions. The orientation menu beside Paper can rotate the tablet menu bars with the page, accounting for the display orientation already set by the operating system. The tablet close button closes that window for the session; the chosen drawing location returns on the next launch. An enabled Wacom opens with the workspace immediately. Buttons show tooltips under the pen as well as the mouse. Right-click selects, moves or resizes ink without changing the drawing tool. On macOS, NoteMind requests Input Monitoring and opens its System Settings pane when access is missing.
- The native tablet subsystem, pressure, palm rejection and device mapping. Pen, Eraser, Select, colour swatches and the width dropdown are directly on the drawing bar. The [pen buttons](docs/PEN-BUTTONS.md) say exactly what each side button does: delete, select, Undo, Redo, zoom and scroll. Mouse and pen can both draw or move selected ink. Clear Sheet has its own button.
- Persistent drawing sheets, paper types/spacing/colours, image backgrounds, editable graphics pane round trips, drawing files, project and document attachments, SVG/PNG exports, and copying selected drawings. Incoming graphics always land in a docked pane. See [the graphics pane format](docs/GRAPHICS-PANES.md).
- Camera devices per tab, live and still tabs, editable annotations, hold, keep page, rotation, aspect cropping, selection movement/resizing, page corners and perspective correction, zoom, transparent writing captures, image captures, and rescanning drawing backgrounds. Captures from a live source clear the captured ink with one-step undo; Raw keeps the ink.
- A document viewer in the drawing pane for PDF, DOCX, and images: selections, text and picture extraction, background removal, fit/zoom, PDF search and page navigation, image rotation, and conversion to a new Notepad. Word displays a semantic, reflowed document.
- Offline text recognition with editable review, detected text positions, English and Japanese recognition, cancellation, insertion into the current or a new Notepad, and automatic reading of scanned PDF pages.
- DOCX and PDF import/export, including headings, paragraphs, lists, links, tables, pictures, and page-size choices.
- Saved `.py` scripts run through Python with streamed output and a Stop command. The interpreter can be selected in Tools.

## Documents

New Notepads and drawings use `.nm`; existing `.wm` archives still open. `.nm` Notepads are versioned ZIP files containing `manifest.json`, `document.md`, and an `assets/` directory. Every attachment has a size and SHA-256 checksum. Editable drawings keep stroke data alongside their images. Saved drawings use `.nm` too, distinguished by their manifest; projects use `.wmpr`. See [FORMAT.md](FORMAT.md).

File → Copy Notepads to iCloud Drive (off until ticked; macOS and Windows) keeps a one-way copy of each saved Notepad, and of every Notepad in Documents/NoteMind, in iCloud Drive/NoteMind, in the same folders, for reading elsewhere. Originals stay where they are; copies follow changes and deletions, and edits to a copy are not brought back. Copies made are listed in `icloud-copy-state.json` and problems logged in `icloud-copy.log`, both in the app's data folder.

Plain `.md`, `.txt`, and `.py` files open and save directly. Markdown exports put images and file attachments in a companion assets directory; reopening them restores previews and metadata. Only saved `.py` files can run. The editor switches between visual and Markdown modes. The formatting bar stays visible in both modes; the Notepad menu and context menu also expose writing tools.

File → Open shows Word, PDF, and image documents in the right pane. Convert makes a new Notepad; the input file stays intact. File → Import Word or PDF imports directly into a new Notepad. PDF import can retain page images for visual fidelity, editable text, or both. File → Export Word / Export PDF writes a separate document. Word support uses DOCX. Text recognition is local and supports review and correction; handwriting accuracy depends on the input.

Drawing sheets, camera pages, project membership, and window layout persist locally. Drafts, version snapshots, the searchable library, and deleted-item recovery copies live in the application's data directory. A failed or conflicting autosave leaves a recoverable draft and a visible status message. Named workspace files save their membership changes automatically.

## Updates

The installed Mac app (Apple Silicon) checks the GitHub releases of this repository 30 seconds after it starts and every six hours, and downloads a newer version in the background. When it is ready the app asks whether to restart and install now; Later installs it the next time the app starts. **Help > Check for Updates** checks at once and **Help > Check for Updates Automatically** turns the background checks off. Progress is logged in `updates.log` in the app's data folder.

An update is installed only if it is signed by the same developer identity as the running app; macOS enforces that, so the release zip is the whole trust chain and there is no separate update key. Copies run from source or built without that signature never update.

To release: raise `version` in `package.json` (and the lock file), run `npm run build`, then `npm run package:update`. It checks the signature and writes `dist/NoteMind-<version>-mac-arm64.zip`. Create the release with `gh release create v<version> dist/NoteMind-<version>-mac-arm64.zip`. The updater looks for that exact asset name in the latest non-draft, non-prerelease release.

## Checks

`npm test` covers archives, checksums, Word round trips, Markdown image sidecars, file history, projects and the `.wmpr` format, image processing, Python, selections, tab buffers, and storage validation. Electron tests in `test/review.cjs`, `test/restart.cjs`, `test/sidebar.cjs`, `test/document-pane.cjs`, `test/document-integration.cjs`, and `test/welcome.cjs`, `test/editor-toolbar.cjs`, `test/workspace-ux.cjs`, `test/tables-styles.cjs`, `test/notes-features.cjs`, `test/notes-recovery.cjs`, `test/keys-format.cjs`, `test/projects.cjs`, `test/find-replace.cjs`, `test/clipboard.cjs`, `test/footer.cjs`, `test/structure.cjs`, `test/tabs-recents.cjs`, `test/pdf-export.cjs`, `test/help.cjs` and `test/icloud-copy.cjs` exercise the application. `test/restart.cjs` reads the profile `test/review.cjs` leaves, so run them in that order; `test/pen-smoke.cjs` is a plain Node script. The document integration check also opens the exported DOCX in LibreOffice. `node test/portable.cjs` checks the packaged executable, native tablet bridge, independent workspace windows, and shutdown.

`node test/validate-round.cjs source` and `node test/validate-round.cjs packaged` run the two complete validation rounds.

`node scripts/install-preview.cjs` installs the built app at `~/Applications/NoteMind Preview.app` without launching it or replacing the normal app. Preview uses its own bundle identity and stores all of its data and documents under `~/Documents/NoteMind Preview`.
