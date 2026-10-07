import { createContext } from 'react'
export const ExportContext = createContext<((kind: 'guests' | 'rooms' | 'seating') => void) | null>(null)
