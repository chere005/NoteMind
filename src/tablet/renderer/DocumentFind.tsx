

import { useEffect, useRef, useState, type RefObject } from "react"
import { Icon } from "./icons"

interface FindProps {
  query: string
  onQuery(query: string): void
  
  label: string
  
  canStep: boolean
  onNext(): void
  onPrevious(): void
  onClose(): void
  inputRef?: RefObject<HTMLInputElement | null>
  autoFocus?: boolean
}


export function FindStrip({ query, onQuery, label, canStep, onNext, onPrevious, onClose, inputRef, autoFocus = true }: FindProps) {
  const ownInput = useRef<HTMLInputElement | null>(null)
  const input = inputRef ?? ownInput
  useEffect(() => { if (autoFocus) { input.current?.focus({ preventScroll: true }); input.current?.select() } }, [input, autoFocus])
  return (
    <div className="doc-find" role="search" aria-label="Find in this PDF" data-doc="find">
      <Icon name="search" size={14} />
      <input ref={input} type="text" value={query} placeholder="Find in this PDF" aria-label="Find in this PDF" spellCheck={false} autoComplete="off"
             data-doc-find="input"
             onChange={(event) => onQuery(event.target.value)}
             onKeyDown={(event) => {
               if (event.nativeEvent.isComposing || event.keyCode === 229) return
               if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); if (event.shiftKey) onPrevious(); else onNext() }
               else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose() }
             }} />
      <span className="doc-find-count" data-doc-find="count" aria-live="polite">{label}</span>
      <button type="button" className="bar-btn" data-doc-find="previous" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={!canStep} onClick={onPrevious}><Icon name="chevu" /></button>
      <button type="button" className="bar-btn" data-doc-find="next" aria-label="Next match" title="Next match (Enter)" disabled={!canStep} onClick={onNext}><Icon name="chev" /></button>
      <button type="button" className="bar-btn" data-doc-find="close" aria-label="Close find" title="Close find (Esc)" onClick={onClose}><Icon name="close" /></button>
    </div>
  )
}

interface PageProps {
  autoFocus?: boolean
  
  page: number
  pages: number
  
  parse(text: string): number | null
  onGo(page: number): void
  
  onClose(): void
  
  onInvalid(text: string): void
}


export function PageField({ page, pages, parse, onGo, onClose, onInvalid, autoFocus = true }: PageProps) {
  const [text, setText] = useState(String(page))
  const input = useRef<HTMLInputElement | null>(null)
  const done = useRef(false)
  useEffect(() => { if (autoFocus) { input.current?.focus({ preventScroll: true }); input.current?.select() } }, [autoFocus])
  const finish = (go: boolean) => {
    if (done.current) return
    if (go) {
      const to = parse(text)
      if (to === null) { onInvalid(text); return }
      done.current = true
      onGo(to)
    } else done.current = true
    onClose()
  }
  return (
    <span className="fact page-field" data-camera="status-fact" data-doc="page-field">
      Page{" "}
      <input ref={input} type="text" inputMode="numeric" value={text} aria-label={`Go to page, 1 to ${pages}`} size={Math.max(2, String(pages).length)}
             data-doc-page="input" spellCheck={false} autoComplete="off"
             onChange={(event) => setText(event.target.value)}
             onKeyDown={(event) => {
               if (event.nativeEvent.isComposing || event.keyCode === 229) return
               if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); finish(true) }
               else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false) }
             }}
             // (Clicking away puts the field back to the words without going anywhere.)
             onBlur={() => finish(false)} />
      {" "}of {pages}
    </span>
  )
}
