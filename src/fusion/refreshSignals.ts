/** Connectivity/foreground hints trigger a bounded refresh, never explicit draft approval. */
export function refreshSignals(
  refresh: () => Promise<unknown>,
  win: Pick<Window, 'addEventListener' | 'removeEventListener' | 'setInterval' | 'clearInterval'> = window,
  doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> = document,
) {
  let stopped = false, running = false
  const request = () => {
    if (stopped || running || doc.visibilityState !== 'visible') return
    running = true
    void Promise.resolve().then(() => { if (!stopped) return refresh() }).catch(() => undefined).finally(() => { running = false })
  }
  win.addEventListener('online', request)
  doc.addEventListener('visibilitychange', request)
  const timer = win.setInterval(request, 10000)
  return () => {
    stopped = true
    win.clearInterval(timer)
    win.removeEventListener('online', request)
    doc.removeEventListener('visibilitychange', request)
  }
}
