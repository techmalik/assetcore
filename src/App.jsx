import { Routes, Route, Navigate } from 'react-router-dom'
import { useState } from 'react'
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

  if (!authed) return <Auth onLogin={() => { localStorage.setItem('ac_authed','1'); setAuthed(true) }} />

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<Dashboard dark={dark} toggleDark={toggleDark} />} />
      <Route path="/assets" element={<Assets dark={dark} toggleDark={toggleDark} />} />
      <Route path="/work-orders" element={<WorkOrders dark={dark} toggleDark={toggleDark} />} />
      <Route path="/maintenance" element={<Maintenance dark={dark} toggleDark={toggleDark} />} />
      <Route path="/notifications" element={<Notifications dark={dark} toggleDark={toggleDark} />} />
      <Route path="/reports" element={<Reports dark={dark} toggleDark={toggleDark} />} />
      <Route path="/admin" element={<Admin dark={dark} toggleDark={toggleDark} />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
