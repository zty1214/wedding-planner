import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

/** Keep a single form mounted while switching between desktop inline and phone modal. */
export default function ResponsiveEditor({ label, open, enabled = true, children }: { enabled?: boolean; label: string; open: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (!enabled) return
    const dialog = ref.current!, media = matchMedia('(max-width:767px)')
    let opener: HTMLElement | null = null
    const apply = () => {
      const shouldOpen = !media.matches || open
      if (dialog.open) dialog.close()
      dialog.classList.toggle('planner-editor-modal', media.matches)
      if (shouldOpen) {
        if (media.matches) {
          opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
          dialog.showModal()
        } else dialog.show()
      } else if (opener?.isConnected) opener.focus()
    }
    apply(); media.addEventListener('change', apply)
    return () => { media.removeEventListener('change', apply); dialog.close(); if (opener?.isConnected && opener.getClientRects().length) opener.focus() }
  }, [open, enabled])
  if (!enabled) return <>{children}</>
  return <dialog ref={ref} className="planner-dialog planner-editor" aria-label={label} onCancel={event => {
    event.preventDefault()
    ref.current?.querySelector<HTMLButtonElement>('[data-editor-close]')?.click()
  }}>{children}</dialog>
}
