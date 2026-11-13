# NoteMind archive format, version 1

The `.nm` extension identifies a ZIP archive. Existing `.wm` archives remain readable and can be saved as `.nm`. Entry names use forward slashes. All JSON and Markdown text is UTF-8. Absolute paths, empty path components, and parent traversal are rejected.

Every current archive has:

* `manifest.json`: `format: "notemind"`, `version: 1`, `kind`, `id`, `title`, `created`, `modified`, `meta`, `content: "document.md"`, and `files`.
* `document.md`: ordinary Markdown. Images and attachment links reference relative paths under `assets/`. Task lists use `- [ ]` and `- [x]`; highlights use `==text==`; tables and nested lists use Markdown syntax. Links to another Notepad use `[Title](notemind:<id>)`.
* `assets/`: binary images, PDFs and other file attachments, preview images, and optional editable drawing descriptions. Images remain ordinary document content.

`files` maps each entry other than the manifest to `{bytes, sha256}`. The reader checks size and checksum and rejects unlisted entries. Readers reject unknown versions and kinds. Writers retain the document ID across saves and update the ISO timestamp. Files are replaced atomically after a complete archive is written.

`meta` contains `tags`, `pinned`, `collapsed` heading keys, and an `attachments` map. Each attachment entry may contain its display title, byte count, PDF page count, preview asset name, and extracted search text. Existing archives without this metadata remain readable.

Kinds are `notepad`, `drawing`, and `workspace`. A drawing adds `drawing.json` describing its page proportions, pressure samples, stroke colors and widths, paper, and optional background. A workspace adds `workspace.json` describing folder/file links, section order, and hidden sections. This kind is the older way to save a project: opening one writes a `.wmpr` beside it and leaves the `.wm` untouched.

## Project file, `.wmpr`

A project is a name (the file's own name) and the files and folders put in it. The file is UTF-8 JSON with the keys `excluded`, `files`, `folders` and `version` (2), printed with sorted keys, two-space indent and `"key" : value`. Paths are relative to the project file's folder when they lie at or under it, absolute otherwise; a reader takes both and keeps a path from another kind of machine exactly as written. Unknown keys are kept. A version above 2 opens read-only and is never written. The project saves itself after every change. Links refer to external files; a project is not a backup of their contents.

Imported images receive stable relative asset names. An image can have an adjacent `.json` asset holding editable strokes so Edit with Tablet can recover the drawing. Cleaning unused assets retains the drawing description while its image is referenced.

Limits are 9,999 indexed entries, 50 MiB per entry, and 199 MiB of indexed uncompressed content. The ZIP reader also limits total expanded size and checks ZIP integrity. Earlier NoteMind drafts containing `document.md` without a manifest remain readable and receive a manifest when saved.

Markdown export uses a companion `<document>.assets` folder with content-derived names. The companion directory includes `notemind.json` for identity, tags, pins, previews, and editable drawing references. Import reads local attachments contained inside the Markdown file's directory, resolves real paths, and does not download remote content. Text and Python files store plain UTF-8 text.

Local recovery stores atomic `.wm` draft snapshots plus a session index. Version history stores independent complete archives, and restoring a version first preserves the current state. Saved files have a content revision so autosave rejects external edits. Recently Deleted keeps a recovery copy and refuses to overwrite occupied restore destinations. These local stores are separate from a shared document archive.
