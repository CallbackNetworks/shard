import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import ProjectDetail from './pages/ProjectDetail'
import Integrations from './pages/Integrations'

const navStyle = { textDecoration: 'none', color: '#555', padding: '8px 16px', borderRadius: '6px', fontWeight: 500 }
const activeStyle = { ...navStyle, background: '#4f46e5', color: '#fff' }

export default function App() {
  return (
    <BrowserRouter>
      <header style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 24 }}>
        <span style={{ fontWeight: 700, fontSize: 18, color: '#4f46e5' }}>TODO Platform</span>
        <nav style={{ display: 'flex', gap: 8 }}>
          <NavLink to="/" end style={({ isActive }) => isActive ? activeStyle : navStyle}>Projects</NavLink>
          <NavLink to="/integrations" style={({ isActive }) => isActive ? activeStyle : navStyle}>Integrations</NavLink>
        </nav>
      </header>
      <main style={{ maxWidth: 1100, margin: '32px auto', padding: '0 24px' }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/integrations" element={<Integrations />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}
