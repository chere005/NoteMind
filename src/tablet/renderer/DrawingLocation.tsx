import { useEffect, useState } from 'react'
import { Icon } from './icons'

/** Where the sheet is drawn: this window or the Wacom screen. One source of truth for the button and the menu row. */
export function usePadLocation() {
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    const api = window.notemind?.pad
    if (!api) return
    let live = true, pushed = false
    api.state().then(value => { if (live && !pushed) setState(value) }).catch(() => {})
    const off = api.onState(value => { pushed = true; if (live) setState(value) })
    return () => { live = false; off() }
  }, [])
  const available = !!state?.available
  const wacom = !!(state?.enabled && state.owned && available)
  const toggle = () => { setBusy(true);setError('');void window.notemind.pad.set(!wacom).then(setState).catch(error => setError('Could not switch drawing location: ' + error.message)).finally(() => setBusy(false)) }
  return { available, wacom, busy, error, toggle }
}

export function DrawingLocation() {
  const { available, wacom, busy, error, toggle } = usePadLocation()
  const title = error || (!available ? 'In this window · Wacom screen unavailable' : wacom ? 'Wacom screen · Switch to this window' : 'In this window · Switch to Wacom screen')
  return <button type="button" className={'bar-btn drawing-location' + (wacom ? ' on' : '')}
    data-drawing-location={wacom ? 'wacom' : 'window'} aria-label="Use Wacom screen" aria-pressed={wacom}
    title={title} disabled={busy || !available}
    onClick={toggle}>
    <Icon name={wacom ? 'display' : 'window'} />
  </button>
}
