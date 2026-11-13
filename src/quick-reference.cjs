// The text of the Quick Reference Notepad (Help > Quick Reference). The shortcut list comes from the real menu, so it cannot drift;
// the sections below are the part to keep current: every change to what the app can do updates them in the same commit.
const sections=[
 [
  "Writing",
  [
   "Paste keeps plain text; copied web pages that have no plain text become Markdown, and a copied picture is added to the Notepad. Drop pictures on the page to insert them, or drop a Notepad, text file, Word or PDF file to open it. Right-click for Cut, Copy, Paste, Select All and spelling suggestions.",
   "In a code block, ( [ { \" ' and ` close themselves and typing the closer steps over it. In the Markdown pane a quote continues on Return and Backspace in indentation removes one level.",
   "Notepad → Writing Tools has checklists, nested lists, highlights and editable tables. Tab indents a list or moves through a table; Enter continues a task. Heading arrows collapse or expand sections. The Markdown toolbar stays visible."
  ]
 ],
 [
  "Pages, tabs and the sidebar",
  [
   "The footer shows the word count of the words you can see, when the Notepad was last saved, and the zoom. The window follows the system light or dark appearance.",
   "File → Open Recent and Projects → Open Recent list the last twelve files and projects. The wheel over the tab row walks the tabs, middle-click closes one, and its right-click menu also renames, duplicates, moves, reveals or trashes the file. Each tab reopens scrolled to the same words.",
   "Drag sidebar rows to reorder or move. Right-click to rename, duplicate, move, hide a section or send it to Trash. Edit has Undo File Action and Redo File Action.",
   "The project menu (the project name at the foot of the sidebar, and the Projects menu) manages folders and file links, hidden sections, and separate project windows. Save Workspace As creates a .wmpr project file."
  ]
 ],
 [
  "Drawing and camera",
  [
   "On a drawing sheet choose Pen, Eraser or Select for either the pen or the mouse. Select a box around strokes, then drag inside it to move them; corner handles resize the selected ink. Each move is one Undo. An extended Wacom display can show the drawing pane, with an interactive mirror in the main window. Drawing location chooses In this window or Wacom screen directly on the drawing bar and its mirror. In mirrored display mode, draw directly in the right pane; on an extended Wacom screen only the drawing pane moves there. The choice is remembered. Independent pen capture may require Input Monitoring permission in macOS System Settings. Pen, Eraser, Select, colour swatches and the width dropdown are directly on the bar. Clear the Sheet has its own undoable button. Hold the lower side button to delete strokes and double-tap for Undo; hold and drag the upper button to select and double-tap for Redo. Advanced tablet settings remain under Input Devices.",
   "Camera tabs remember their devices. Hold freezes a frame; Keep Page retains a still. Find Page exposes adjustable corners. Bring in inserts Writing, Image or Raw captures. Drag inside a selection to move it, or drag its handles to resize it. Zoom and page detection are in the header; rotation and tablet orientation are in the Video menu. Input Devices has Aspect Ratio. Double-click the picture to toggle video-only view.",
   "Right-click an image to resize, rotate or crop it, or edit it with the tablet. Keep in Open Notepad embeds both the image and its editable drawing. Save to Original updates an image being edited; Keep in Project links a saved drawing. Rescan with Camera replaces its background. Drawings are images inside .nm Notepads.",
   "Incoming writing and pictures always create a docked graphics pane with a preview and editable strokes. Edit in Wacom reopens it in the drawing editor; Save to Original updates that pane. The divider keeps its proportion; double-click maximizes the drawing pane and double-click again restores it."
  ]
 ],
 [
  "Documents and pictures",
  [
   "File → Open shows Word, PDF, and images in the right pane. Select a region for text or pictures; View has zoom, fit, background removal, search and page navigation. Convert to NoteMind makes a new Notepad.",
   "File → Import Word or PDF opens DOCX and PDF documents as new Notepads. PDF import offers editable text, page images, or both; scanned pages are read offline. File → Export Word / Export PDF creates a separate document.",
   "Read Text is available in Bring in, selection actions, the image context menu, and File. Review the recognized text, choose English or English and Japanese, and insert it into the current Notepad or a new one, or cancel. No image leaves this computer.",
   "File → Export as PDF… (Ctrl+Shift+E) opens a dialog with a preview of the first page and the options: A4 or Letter, portrait or landscape, normal, narrow or no margins, page numbers (1 / N), removing picture backgrounds, and opening the file afterwards. The options are remembered.",
   "Attach Files embeds originals and shows PDF previews. Attachments lists, opens, saves or removes them. Multipage Scan combines kept camera pages or added pictures into one PDF; arrange and rotate pages before insertion."
  ]
 ],
 [
  "Saving and organising",
  [
   "File → Welcome shows recent documents and projects. Markdown files store their images and attachments in a companion assets folder.",
   "Edits autosave. New drafts recover automatically after closing or restarting. Save As chooses a file. Version History previews and restores earlier saves; Recently Deleted restores items moved to Trash.",
   "Tags and Pin organizes the current Notepad. The project menu has sorting, tags and Smart Folders. Link to Notepad inserts a persistent link. Search includes offline text recognition in attached images and handwriting."
  ]
 ]
];
function markdown(shortcuts){
 return ['# NoteMind Quick Reference','','## Keyboard shortcuts','',shortcuts,'',...sections.flatMap(([title,paragraphs])=>['## '+title,'',...paragraphs.flatMap(p=>[p,''])])].join('\n').trimEnd()+'\n';
}
module.exports={sections,markdown};
