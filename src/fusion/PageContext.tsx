import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand'
import { useWeddingStore as legacyStore } from '../stores/useWeddingStore'
import type { WeddingState } from '../types/weddingState'
import { DEFAULT_GUEST_GROUPS } from '../types'
export const PageStoreContext = createContext<StoreApi<WeddingState> | null>(null)
export function useWeddingStore<T = WeddingState>(selector: (state: WeddingState) => T = state => state as unknown as T): T {
  const store = useContext(PageStoreContext)
  return useStore(store ?? legacyStore, selector)
}
export function useAllGroups() {
  const groups = useWeddingStore(s => s.customGroups)
  return [...DEFAULT_GUEST_GROUPS, ...groups]
}

export function useFusionMode() { return useContext(PageStoreContext) !== null }
