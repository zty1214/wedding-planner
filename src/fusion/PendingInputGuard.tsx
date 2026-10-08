import { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { useBlocker } from 'react-router-dom'
import FusionDialog from './FusionDialog'

type Register = (pending: RefObject<boolean>) => () => void
const PendingInputs = createContext<Register | null>(null)

/** Block route changes only while the latest input lacks a durable local copy. */
export function PendingInputProvider({ children }: { children: ReactNode }) {
  const inputs = useRef(new Set<RefObject<boolean>>())
  const register = useCallback<Register>(pending => {
    inputs.current.add(pending)
    return () => { inputs.current.delete(pending) }
  }, [])
  const hasPending = useCallback(() => [...inputs.current].some(input => input.current), [])
  const blocker = useBlocker(hasPending)
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (hasPending()) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasPending])
  return <PendingInputs.Provider value={register}>
    {children}
    {blocker.state === 'blocked' && <FusionDialog label="未保存输入离开确认" onClose={() => blocker.reset()}>
      <section data-input-leave-guard className="space-y-3">
        <h2>最新输入尚未保存在本机</h2>
        <p>留在页面可复制输入或重试保存。继续离开会放弃尚未保存的输入，已经落盘的草稿仍保留。</p>
        <button onClick={() => blocker.reset()}>留在页面</button>
        <button onClick={() => blocker.proceed()}>放弃未保存输入并离开</button>
      </section>
    </FusionDialog>}
  </PendingInputs.Provider>
}

export function usePendingInputGuard(pending: RefObject<boolean>) {
  const register = useContext(PendingInputs)
  useEffect(() => register?.(pending), [register, pending])
}
