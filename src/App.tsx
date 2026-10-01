import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import GuestsPage from './pages/GuestsPage'
import SeatingPage from './pages/SeatingPage'
import AccommodationPage from './pages/AccommodationPage'
import NotesPage from './pages/NotesPage'

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/seating" replace />} />
        <Route path="/guests" element={<GuestsPage />} />
        <Route path="/seating" element={<SeatingPage />} />
        <Route path="/stay" element={<AccommodationPage />} />
        <Route path="/notes" element={<NotesPage />} />
        {/* 分享链接路由 */}
        <Route path="/p/:projectId" element={<Navigate to="seating" replace />} />
        <Route path="/p/:projectId/guests" element={<GuestsPage />} />
        <Route path="/p/:projectId/seating" element={<SeatingPage />} />
        <Route path="/p/:projectId/stay" element={<AccommodationPage />} />
        <Route path="/p/:projectId/notes" element={<NotesPage />} />
      </Route>
    </Routes>
  )
}

export default App
