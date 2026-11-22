// The text of the Quick Reference Notepad (Help > Quick Reference). The shortcut list comes from the real menu, so it cannot drift;
// the sections below are the part to keep current: every change to what the app can do updates them in the same commit.
const sections=[
 [
  "Writing",
  [
   "Choose Explore Features on the welcome screen or Help → Welcome to NoteMind for an editable guide with a working checklist, table, drawing, and attached PDF. Your changes to the guide are kept.",
   "Paste keeps plain text; copied web pages that have no plain text become Markdown, and a copied picture is added to the Notepad. Drop pictures on the page to insert them, or drop a Notepad, text file, Word or PDF file to open it. Right-click for Cut, Copy, Paste, Select All and spelling suggestions.",
   "Code blocks use syntax highlighting in light and dark appearance. Choose their language button, or add a language after the opening Markdown fence (for example ```rust). The selection is kept when colours update. Tab inserts four spaces, Return continues indentation, and Command/Ctrl+Return leaves the block. Plain Text disables colouring. The supported groups are C, C++, Rust, CMake, Python, Verilog, HTML, CSS, TypeScript, JavaScript, Bash/Zsh, JSON, YAML, TOML/INI, SQL, Markdown, Makefile, Dockerfile, diff/patch, Go, Java, C#, Swift and PHP; common aliases, JSX and TSX work too.",
   "In a code block, ( [ { \" ' and ` close themselves and typing the closer steps over it. In the Markdown pane a quote continues on Return and Backspace in indentation removes one level.",
   "Notepad → Writing Tools has checklists, nested lists, highlights and editable tables. Tab indents a list or moves through a table; Enter continues a task. Heading arrows collapse or expand sections. The Markdown toolbar stays visible."
  ]
 ],
 [
  "Pages, tabs and the sidebar",
  [
   "Image-heavy Notepads keep a stable scrollbar. Click the blank line below the last picture to continue writing. The footer shows the word count of the words you can see, when the Notepad was last saved, and the zoom. The window follows the system light or dark appearance.",
   "File → Open Recent and Projects → Open Recent list the last twelve files and projects. The wheel over the tab row walks the tabs, middle-click closes one, and its right-click menu also renames, duplicates, moves, reveals or trashes the file. Each tab reopens scrolled to the same words.",
   "Drag the sidebar divider to resize it. Small windows tuck the sidebar away; its icon or Search Notepads brings it back. Drag sidebar rows to reorder or move. The sidebar’s split plus creates a Notepad or a section; the tab bar shows its plus only while the sidebar is hidden. Organize shows duplicate and two-click delete controls on saved files and drafts. Every Notepad row, including search results, has Open, Rename, Duplicate and deletion in its menu. Saved files move to Trash; unsaved drafts go to Recently Deleted. Remove from Project only removes a link and keeps the file. Right-click to rename, duplicate, move, hide a section or send it to Trash. Edit has Undo File Action and Redo File Action.",
   "Click a menu button again to close its menu; the next click opens it immediately. The writing toolbar separates Lists, Insert and Format. Insert adds images, tables, attachments, scans and links; Format keeps advanced text and paragraph actions available in a narrow editor. The eye immediately to the right of the sidebar toggle is on for the rendered page and off for Markdown source. Notepad options beside the tabs holds Save, Export, Find, history and the open-tab list. The project menu (the project name at the foot of the sidebar, and the Projects menu) manages folders and file links, hidden sections, and separate project windows. Save Workspace As creates a .wmpr project file."
  ]
 ],
 [
  "Drawing and camera",
  [
   "On a drawing sheet choose Pen, Eraser or Select for either the pen or the mouse. Tap a stroke or drag a box to select ink. Drag inside the selection to move it. Each move is one Undo. An extended Wacom display can show the drawing pane, with an interactive mirror in the main window. Use the mouse in that mirror to draw, select, move, resize and erase; pen hover on the Wacom does not interrupt mouse gestures. The drawing-location icon toggles In this window or Wacom screen directly on the drawing bar and its mirror. In mirrored display mode, draw directly in the right pane; on an extended Wacom screen only the drawing pane moves there. The choice is remembered. Independent pen capture may require Input Monitoring permission in macOS System Settings. Pen, Eraser, Select, colour and width are directly on the bar. Narrow panes use a fixed-size colour menu instead of squeezing the swatches. The orientation icon beside Paper changes between landscape, portrait and the two reversed orientations. New pages use A5 proportions and fit the available writing area. Check Rotate menu bars with page to turn the tablet interface with the page before physically rotating the Wacom; the choice is remembered. The right pane keeps fixed-size live menu bars above the same page. The tablet close button closes its window. Wacom screen covers the whole extended display. Clear the Sheet has its own undoable button. Hold the lower side button and touch or drag the tip to erase strokes. Hold the upper side button and tap a stroke or drag a box to select. While hovering, double-tap the lower button for Undo or the upper button for Redo. Change these assignments in Drawing → Tablet Settings.",
   "The capture pane’s source menu switches between Drawing, Camera and Document. Its Open Documents submenu retains documents while another source is in use. Drawing and camera tabs show the pages for the chosen source. Camera tabs remember their devices. Hold freezes a frame; Keep Page retains a still. Find Page exposes adjustable corners. Insert adds Writing, Image or Raw Image captures to the open Notepad. Drag inside a selection to move it, or drag its handles to resize it. Zoom and page detection are in the header; rotation and ink actions stay available in Camera options when the pane is narrow. Capture has Aspect Ratio. Double-click the picture to toggle video-only view.",
   "Right-click an image to resize, rotate or crop it, or edit it with the tablet. Pictures use the largest available editing area at their original aspect ratio, including on the Wacom screen. Existing drawings retain their saved page shape. Keep in Open Notepad embeds both the image and its editable drawing. Save to Original updates an image being edited; Keep in Project links a saved drawing. Rescan with Camera replaces its background. Drawings are images inside .nm Notepads.",
   "In Drawing, Command/Ctrl+C copies the selection as editable strokes and an image; Command/Ctrl+V pastes strokes into the current sheet with one Undo. Pasted pictures open their own drawable sheet. Selection controls stay full size in the Wacom mirror. Closing a drawing tab on the Wacom shows Save, Don’t Save and Cancel there.",
   "Incoming writing and pictures always create a docked graphics pane with a preview and editable strokes. Edit in Wacom reopens it in the drawing editor; Save to Original updates that pane. Double-click the Drawing divider to restore Fit and reset the pane to 1080 pixels when space allows. Drag the divider to resize the pane while staying in Fit."
  ]
 ],
 [
  "Documents and pictures",
  [
   "File → Open shows Word, PDF, and images in the right pane. Select a region for text or pictures; View has zoom, fit, background removal, search and page navigation. Convert to NoteMind makes a new Notepad.",
   "File → Import Word or PDF opens DOCX and PDF documents as new Notepads. PDF import offers editable text, page images, or both; scanned pages are read offline. File → Export Word / Export PDF creates a separate document.",
   "Read Text is available in Insert, selection actions, the image context menu, and File. Review the recognized text, choose English or English and Japanese, and insert it into the current Notepad or a new one, or cancel. No image leaves this computer.",
   "File → Export as PDF… (Ctrl+Shift+E) opens a dialog with a preview of the first page and the options: A4 or Letter, portrait or landscape, normal, narrow or no margins, page numbers (1 / N), removing picture backgrounds, and opening the file afterwards. The options are remembered.",
   "Attach Files embeds originals and shows PDF previews. Attachments lists, opens, saves or removes them. Multipage Scan combines kept camera pages or added pictures into one PDF; arrange and rotate pages before insertion."
  ]
 ],
 [
  "Saving and organising",
  [
   "File → Welcome shows recent documents and projects. Markdown files store their images and attachments in a companion assets folder.",
   "Edits autosave. New drafts recover automatically after closing or restarting. Save As chooses a file. Version History previews and restores earlier saves; Recently Deleted restores saved files and unsaved drafts, including their latest recovered edits. File → Delete Notepad and the sidebar Delete key use the same recoverable deletion.",
   "File → Copy Notepads to iCloud Drive keeps a copy of each Notepad you save, and of every Notepad in Documents › NoteMind, in iCloud Drive › NoteMind, in the same folders, for reading on your other devices. The originals stay where they are; a copy is replaced when its Notepad changes and removed when it is deleted. Changes made to a copy are not brought back.",
   "Tags and Pin organizes the current Notepad. Notepads options in the sidebar has sorting, tags, Smart Folders and Recently Deleted. The footer’s project menu owns Add Files and Add Folder. Link to Notepad inserts a persistent link. Search includes offline text recognition in attached images and handwriting."
  ]
 ]
];
function markdown(shortcuts){
 return ['# NoteMind Quick Reference','','## Keyboard shortcuts','',shortcuts,'',...sections.flatMap(([title,paragraphs])=>['## '+title,'',...paragraphs.flatMap(p=>[p,''])])].join('\n').trimEnd()+'\n';
}
module.exports={sections,markdown};
