/** Shared menu and split-action buttons; each popup stays in its triggering window. */

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { FloatingMenu, type MenuItem } from "./FloatingMenu"
import { Icon, type IconName } from "./icons"
import { caretBarFor, optionsName, shapeOf } from "./splitButton"
import { menuRect } from "./padCoordinates"

interface Props {
  icon?: IconName
  /** Words on the button (the block style's current level); an icon-only button has none. */
  label?: ReactNode
  /** Tooltip, and the accessible name when there is no label or `name`. */
  title: string
  /** The accessible name when the label is not a name (a count), and the short name a split's ▾ segment is "<name> options" of. */
  name?: string
  items: MenuItem[] | (() => MenuItem[])
  /** The button's own click. With it the button is a SPLIT (a ▾ segment beside it opens the menu); without it a click opens the menu. */
  onOpen?: () => void
  onMain?: () => void
  /** Lit: on (accent fill) or softly (tint). */
  on?: boolean
  tint?: boolean
  /** The whole button is off: both segments of a split. */
  disabled?: boolean
  /**
   * Only the main segment of a split is off: its job cannot be done now but its menu still works (Bring in on a drawing region's
   * own sheet: the remembered choice is off, other options are not).
   */
  mainOff?: boolean
  /** A small chevron after the label (a control that shows a value). */
  chevron?: boolean
  /** The one filled button of a bar (Bring in): both segments of a split take the accent. */
  primary?: boolean
  /** The ▾ segment's tooltip (a sentence); its accessible name is "<name> options" unless `optionsLabel` says otherwise. */
  caretTitle?: string
  /** The ▾ segment's accessible name, when "<name> options" is not it (a button named for its job or its state, not for what its menu is of). */
  optionsLabel?: string
  /** The ▾ segment's `data-bar`; by default the button's `dataBar` and "-menu". */
  caretDataBar?: string
  /** More test hooks on the ▾ segment, `data-<name>`. */
  caretData?: Record<string, string>
  /**
   * The menu FOLLOWS the state while it is up: its rows are asked for again on every render, not once when it opens. For a
   * menu whose rows change under the person's hand and which stays up for it (the pen's colour, width and switch, Sean,
   * 2026-10-10: "[colour and width] should be under this dropdown"). The rows keep their keys, so the row the person is on
   * keeps the keyboard; a menu that does not change while open leaves this off and is built once.
   */
  live?: boolean
  className?: string
  /** Test hook (on the main button of a split). */
  dataBar?: string
  /** Test hook on the menu this button opens (`data-bar` of the floating menu). */
  menuBar?: string
  /** More test hooks, `data-<name>`: `{ tablet: "undo" }` is `data-tablet="undo"` (the video pane's buttons keep theirs). */
  data?: Record<string, string>
  style?: React.CSSProperties
  children?: ReactNode
}

const HOLD_MS = 500

const dataAttributes = (data: Record<string, string> | undefined) =>
  Object.fromEntries(Object.entries(data ?? {}).map(([key, value]) => [`data-${key}`, value]))

export function MenuButton({ icon, label, title, name, items, onOpen, onMain, on, tint, disabled, mainOff, chevron, primary, caretTitle, optionsLabel, caretDataBar, caretData, live, className, dataBar, menuBar, data, style, children }: Props) {
  const sequence=useRef(0),menuId=useId(),focusTarget=useRef<HTMLElement|null>(null)
  const split = shapeOf(onMain) === "split"
  const button = useRef<HTMLButtonElement>(null)
  const caret = useRef<HTMLButtonElement>(null)
  const shape = useRef<HTMLSpanElement>(null)
  // The menu is built when it is opened and kept: a render of the page behind it (a clock, a save) must not rebuild its
  // rows, which would take the keyboard from the row the person had moved to.
  const [at, setAt] = useState<{ x: number; y: number; left: number; items: MenuItem[]; serial:number; initialFocus: "first"|"last"|"none" } | null>(null)
  const hold = useRef<number | null>(null)
  const holdPointer = useRef<number | null>(null)
  const held = useRef(false)
  const isOpen = useRef(false)

  const list = typeof items === "function" ? items : () => items
  // A split's menu hangs under the WHOLE shape and is right-aligned with it (the pen's way); a menu button's under itself.
  const open = (initialFocus: "first"|"last"|"none" = "none") => {
    onOpen?.()
    const element = split ? shape.current : button.current
    if (!element) return
    const box = menuRect(element)
    isOpen.current=true
    focusTarget.current=button.current?.ownerDocument.activeElement as HTMLElement
    setAt({ serial:++sequence.current,initialFocus,x: split ? box.right : box.left, y: box.bottom + 2, left: box.left, items: list() })
  }
  // A bar's menu is a chrome action: when it goes (Escape, a click elsewhere, a pick) the keyboard is the notes' again
  // (a field a menu item opened keeps it).
  const close = () => { isOpen.current=false;setAt(null) }
  const toggle = () => { if(isOpen.current)close();else open() }
  const stopHold = (event?: {pointerId:number}) => {
    if (event && holdPointer.current !== event.pointerId) return false
    if (hold.current !== null) window.clearTimeout(hold.current)
    hold.current = null
    holdPointer.current = null
    return true
  }
  const cancelHold = (event?: {pointerId:number}) => { if (stopHold(event)) held.current = false }
  useEffect(() => { if (disabled || mainOff) cancelHold() }, [disabled, mainOff])
  useEffect(() => () => { cancelHold() }, [])

  const classes = ["bar-btn", label !== undefined ? "label" : "", on ? "on" : "", tint ? "tint" : "", primary ? "primary" : "", className ?? ""]
    .filter(Boolean).join(" ")
  const main = (
    <button ref={button} type="button" className={classes} style={style} disabled={disabled || mainOff} data-bar={dataBar}
            {...dataAttributes(data)}
            aria-label={name ?? (label === undefined ? title : undefined)} title={title}
            // (A split's main part opens no menu on a click: its popup, and whether it is open, are its ▾'s to say, not both parts'.)
            aria-controls={!split&&at?menuId:undefined}
            aria-haspopup={split ? undefined : "menu"} aria-expanded={split ? undefined : at !== null}
            aria-pressed={split && (on!==undefined||tint!==undefined) ? !!(on || tint) : undefined}
            onMouseDown={event=>{if(event.button===0)event.preventDefault()}}
            onPointerDown={(event) => {
              if (!split || disabled || mainOff || event.button !== 0 || holdPointer.current !== null) return
              holdPointer.current = event.pointerId
              held.current = false
              hold.current = window.setTimeout(() => { hold.current = null; held.current = true; open() }, HOLD_MS)
            }}
            onPointerUp={stopHold}
            onPointerLeave={stopHold}
            onPointerCancel={cancelHold}
            onLostPointerCapture={cancelHold}
            // (A button that only opens a menu leaves the right-click to the bar, whose own menu is Customize toolbar…)
            onContextMenu={(event) => { if (!split) return; event.preventDefault(); event.stopPropagation(); if (!disabled) open() }}
            onKeyDown={(event) => {
              if (disabled) return
              if (["ArrowDown","ArrowUp"].includes(event.key)) { event.preventDefault();event.stopPropagation(); open(event.key==="ArrowDown"?"first":"last") }
            }}
            onClick={() => {
              if (disabled || mainOff) return
              if (held.current) { held.current = false; return }
              if (!split) {
                // The second press on a menu button is the way to put its menu away.
                toggle()
              } else onMain?.()
            }}>
      {icon && <Icon name={icon} />}
      {label !== undefined && <span className="bar-label-text">{label}</span>}
      {chevron && <Icon name="chev" size={10} className="chev" />}
      {children}
    </button>
  )
  const arrowName = optionsLabel ?? optionsName(name, title)
  return (
    <>
      {split ? (
        <span ref={shape} className={`bar-split${on ? " on" : ""}${tint ? " tint" : ""}${primary ? " primary" : ""}${disabled ? " disabled" : ""}`}>
          {main}
          {/* The arrow: a button of its own, full height, beside the main one — the corner of a 28px button was twelve pixels. */}
          <button ref={caret} type="button" className="bar-btn caret" disabled={disabled} data-bar={caretBarFor(dataBar, caretDataBar)}
                  {...dataAttributes(caretData)}
                  aria-label={arrowName} title={caretTitle ?? arrowName}
                  aria-controls={at?menuId:undefined} aria-haspopup="menu" aria-expanded={at !== null}
                  onMouseDown={event=>{if(event.button===0)event.preventDefault()}}
                  // (A right-click on the arrow is the menu too, not the bar's Customize toolbar…)
                  onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); if (!disabled) open() }}
                  onKeyDown={(event) => {
                    if (disabled) return
                    if (["ArrowDown","ArrowUp"].includes(event.key)) { event.preventDefault();event.stopPropagation(); open(event.key==="ArrowDown"?"first":"last") }
                  }}
                  onClick={() => {
                    if (disabled) return
                    toggle()
                  }}>
            <Icon name="chev" size={10} className="chev" />
          </button>
        </span>
      ) : main}
      {at && <FloatingMenu key={at.serial} x={at.x} y={at.y} items={live ? list() : at.items} right={split} leftX={at.left} dataBar={menuBar} id={menuId} label={name||title} ownerDocument={button.current?.ownerDocument} returnTo={focusTarget.current} trigger={split?caret.current:button.current} initialFocus={at.initialFocus} onClose={close} />}
    </>
  )
}
