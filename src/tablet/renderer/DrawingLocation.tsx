import { useEffect, useState } from 'react'
import { Icon } from './icons'

export function DrawingLocation() {
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    const api = window.notemind?.pad
    if (!api) return
    let live = true
    api.state().then(value => { if (live) setState(value) }).catch(() => {})
    const off = api.onState(value => { if (live) setState(value) })
    return () => { live = false; off() }
  }, [])
  const wacom = !!(state?.enabled && state?.available)
  const title = error || (!state?.available ? 'In this window · Wacom screen unavailable' : wacom ? 'Wacom screen · Switch to this window' : 'In this window · Switch to Wacom screen')
  return <button type="button" className={'bar-btn drawing-location' + (wacom ? ' on' : '')}
    data-drawing-location={wacom ? 'wacom' : 'window'} aria-label="Use Wacom screen" aria-pressed={wacom}
    title={title} disabled={busy || !state?.available}
    onClick={() => { setBusy(true);setError('');void window.notemind.pad.set(!wacom).then(setState).catch(error => setError('Could not switch drawing location: ' + error.message)).finally(() => setBusy(false)) }}>
    <Icon name={wacom ? 'display' : 'window'} />
  </button>
}
