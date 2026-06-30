import { Routes, Route, Navigate } from 'react-router-dom'
import Home from './pages/index.jsx'

// Marketing website (www.assetcore.com). The product app lives in apps/app
// (app.assetcore.com). Additional routes — Features, Pricing, Integrations,
// Security, About, Contact, Legal — are added in the marketing track.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
