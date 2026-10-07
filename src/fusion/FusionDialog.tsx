import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

/** Native modal provides keyboard containment and returns focus to its opener. */
export default function FusionDialog({ label, onClose, children }: { label: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.showModal()
    return () => { dialog.close(); if (opener?.isConnected) opener.focus() }
  }, [])
  return <dialog ref={ref} className="planner-dialog" aria-label={label} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const controls = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]') ?? []).filter(node => node.getClientRects().length > 0)
    const first = controls[0], last = controls.at(-1)
    if (!first) { event.preventDefault(); ref.current?.focus(); return }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }} onCancel={event => {
    event.preventDefault()
    // Keep the existing panel's busy/confirmation rules for closing.
    const close = Array.from(ref.current?.querySelectorAll('button') ?? []).find(button => button.textContent === '关闭')
    if (!close?.disabled) onClose()
  }}>{children}</dialog>
}
