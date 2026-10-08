import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { PendingInputProvider } from './fusion/PendingInputGuard'
import './index.css'
import App from './App'

const router = createBrowserRouter([{ path: '*', element: <PendingInputProvider><App /></PendingInputProvider> }])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
