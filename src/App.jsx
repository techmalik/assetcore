import { Routes, Route, Navigate } from 'react-router-dom'
import { useState } from 'react'
import Marketing from './pages/Marketing.jsx'
import Auth from './pages/Auth.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Assets from './pages/Assets.jsx'
import WorkOrders from './pages/WorkOrders.jsx'
import Maintenance from './pages/Maintenance.jsx'
import Notifications from './pages/Notifications.jsx'
import Reports from './pages/Reports.jsx'
import Admin from './pages/Admin.jsx'

export default function App() {
  const [authed, setAuthed] = useState(() => localStorage.getItem('ac_authed') === '1')
  const [dark, setDark] = useState(false)

  const toggleDark = () => {
    const next = !dark
    setDark(next)
    document.documentElement.setAttribute('data-theme', next ? 'dark' : '')
  }

  const login = () => { localStorage.setItem('ac_authed','1'); setAuthed(true) }

  return (
    <Routes>
      <Route path="/" element={<Marketing />} />
      <Route path="/auth" element={authed ? <Navigate to="/dashboard" replace /> : <Auth onLogin={login} />} />
      <Route path="/dashboard" element={authed ? <Dashboard dark={dark} toggleDark={toggleDark} /> : <Navigate to="/auth" replace />} />
      <Route path="/assets" element={authed ? <Assets dark={dark} toggleDark={toggleDark} /> : <Navigate to="/auth" replace />} />
      <Route path="/work-orders" element={authed ? <WorkOrders dark={dark} toggleDark={toggleDark} /> : <Navigate to="/auth" replace />} />
      <Route path="/maintenance" element={authed ? <Maintenance dark={dark} toggleDark={toggleDark} /> : <Navigate to="/auth" replace />} />
      <Route path="/notifications" element={authed ? <Notifications dark={dark} toggleDark={toggleDark} /> : <Navigate to="/auth" replace />} />
      <Route path="/reports" element={authed ? <Reports dark={dark} toggleDark={toggleDark} /> : <Navigate to="/auth" replace />} />
      <Route path="/admin" element={authed ? <Admin dark={dark} toggleDark={toggleDark} /> : <Navigate to="/auth" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
