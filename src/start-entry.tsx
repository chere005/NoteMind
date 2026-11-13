

import { useCallback, useEffect, useRef, useState } from "react"
type RecentRow={path:string;name:string;folder:string;kind:string;exists:boolean};



const platform = (): string => (navigator.userAgent.includes("Mac") ? "darwin" : navigator.userAgent.includes("Windows") ? "win32" : "linux")

const KIND_WORDS: Record<RecentRow["kind"], string> = { nm: "nm", wm: "wm", md: "md", txt: "txt", project: "project" }

function Row({ row, onOpen, onForget }: { row: RecentRow; onOpen(row: RecentRow): void; onForget(row: RecentRow): void }) {
  return (
    <div role="button" tabIndex={0} className={`start-row${row.exists ? "" : " missing"}`} data-start="row"
         data-path={row.path} data-kind={row.kind} aria-disabled={!row.exists}
         title={row.exists ? row.path : `${row.path} — not found`}
         onClick={() => { if (row.exists) onOpen(row) }}
         onKeyDown={(event) => {
           if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); if (row.exists) onOpen(row) }
           else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); onForget(row) }
         }}>
      <span className="start-row-text">
        <span className="start-row-name">{row.name}</span>
        <span className="start-row-folder">{row.exists ? row.folder : "not found"}</span>
      </span>
      <span className="start-row-kind" data-start="kind">{KIND_WORDS[row.kind]}</span>
      <button type="button" className="start-forget" data-start="forget" title="Remove from Recent" aria-label={`Remove ${row.name} from Recent`}
              tabIndex={-1}
              onClick={(event) => { event.stopPropagation(); onForget(row) }}>×</button>
    </div>
  )
}

function List({ title, hook, rows, onOpen, onForget }: {
  title: string; hook: string; rows: RecentRow[] | null; onOpen(row: RecentRow): void; onForget(row: RecentRow): void
}) {
  return (
    <section className="start-list" data-start={hook}>
      <h2>{title}</h2>
      {rows === null ? null : rows.length === 0
        ? <div className="start-empty" data-start="empty">Nothing yet</div>
        : rows.map((row) => <Row key={row.path} row={row} onOpen={onOpen} onForget={onForget} />)}
    </section>
  )
}

export function StartScreen() {
  const [info, setInfo] = useState<{ version: string; files: RecentRow[]; projects: RecentRow[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const workspace = useRef<HTMLButtonElement>(null)
  const mac = platform() === "darwin"

  const load = useCallback(async () => {
    const got = await window.notemind.start?.info().catch(() => null)
    if (got) setInfo(got)
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { workspace.current?.focus() }, [])

  const act = useCallback(async (work: () => Promise<unknown>) => {
    setBusy(true)
    try { await work() } finally { setBusy(false); void load() }
  }, [load])
  const openWorkspace = useCallback(() => act(() => window.notemind.start!.workspace()), [act])
  const openGuide = useCallback(() => act(() => window.notemind.start!.guide()), [act])
  const openDialog = useCallback(() => act(() => window.notemind.start!.open()), [act])
  const newProject = useCallback(() => act(() => window.notemind.start!.newProject()), [act])
  const openRow = useCallback((row: RecentRow) => act(() => window.notemind.start!.openPath(row.path)), [act])
  const forget = useCallback((row: RecentRow) => act(() => window.notemind.start!.forget(row.path)), [act])

  // Return is Open Default Workspace (the default button); ⌘O / Ctrl+O is Open File or Workspace…; the arrows walk the
  // rows (from the buttons, Down goes to the first). A row or a button with the keyboard answers Return itself.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const mod = mac ? event.metaKey : event.ctrlKey
      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "o") { event.preventDefault(); void openDialog(); return }
      if (mod && event.shiftKey && !event.altKey && event.key.toLowerCase() === "n") { event.preventDefault(); void newProject(); return }
      const rows = [...document.querySelectorAll<HTMLElement>("[data-start=row]")]
      const at = rows.indexOf(document.activeElement as HTMLElement)
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (rows.length === 0) return
        event.preventDefault()
        const next = event.key === "ArrowDown" ? Math.min(rows.length - 1, at + 1) : at <= 0 ? -1 : at - 1
        if (next < 0) workspace.current?.focus(); else rows[next]!.focus()
        return
      }
      if (event.key === "Enter" && !(document.activeElement instanceof HTMLButtonElement) && at < 0) {
        event.preventDefault()
        void openWorkspace()
      }
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [mac, newProject, openDialog, openWorkspace])

  return (
    <div className={`start${mac ? " mac" : ""}`} data-start="screen" aria-busy={busy}>
      <div className="start-left">
        <img className="start-icon" src="./icon.png" alt="" width={96} height={96} draggable={false} />
        <h1>NoteMind</h1>
        <div className="start-version" data-start="version">{info ? `Version ${info.version}` : ""}</div>
        <div className="start-buttons">
          <button ref={workspace} type="button" className="start-button primary" data-start="workspace" onClick={() => { void openWorkspace() }}>
            Open Default Workspace
          </button>
          <button type="button" className="start-button" data-start="open" onClick={() => { void openDialog() }}>
            Open File or Workspace…<span className="start-key">{mac ? "⌘O" : "Ctrl+O"}</span>
          </button>
          <button type="button" className="start-button" data-start="new-project" onClick={() => { void newProject() }}>
            New Workspace…<span className="start-key">{mac ? "⇧⌘N" : "Ctrl+Shift+N"}</span>
          </button>
          <button type="button" className="start-button" data-start="guide" onClick={() => { void openGuide() }}>
            Explore Features
          </button>
        </div>
      </div>
      <div className="start-right">
        <List title="Recent Workspaces" hook="projects" rows={info?.projects ?? null} onOpen={openRow} onForget={forget} />
        <List title="Recent Files" hook="files" rows={info?.files ?? null} onOpen={openRow} onForget={forget} />
      </div>
    </div>
  )
}

import {createRoot} from 'react-dom/client';createRoot(document.getElementById('root')!).render(<StartScreen/>);