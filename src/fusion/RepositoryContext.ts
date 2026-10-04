import { createContext } from 'react'
import type { projectRepository } from './repository.ts'

export const RepositoryContext = createContext<ReturnType<typeof projectRepository> | null>(null)
