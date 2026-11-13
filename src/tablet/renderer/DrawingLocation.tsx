import { useEffect, useState } from 'react'

export function DrawingLocation() {
  const [state, setState] = useState(null)
  useEffect(() => {
    const api = window.notemind?.pad
    if (!api) return
    let live = true
    api.state().then(value => { if (live) setState(value) }).catch(() => {})
    const off = api.onState(value => { if (live) setState(value) })
    return () => { live = false; off() }
  }, [])
  return <select className="drawing-location" aria-label="Drawing location" title="Draw in this window, or use the extended Wacom screen for the drawing pane"
    value={state?.enabled && state?.available ? 'wacom' : 'window'}
    onChange={event => { void window.notemind.pad.set(event.target.value === 'wacom').then(setState) }}>
    <option value="window">In this window</option>
    <option value="wacom" disabled={!state?.available}>Wacom screen</option>
  </select>
}
