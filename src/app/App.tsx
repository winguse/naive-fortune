import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { HomePage } from '../pages/HomePage'
import { ProfileInitPage } from '../pages/ProfileInitPage'
import { ProfileDashboardPage } from '../pages/ProfileDashboardPage'
import { RecordsPage } from '../pages/RecordsPage'
import { GlobalSummaryPage } from '../pages/GlobalSummaryPage'
import { BacktestPage } from '../pages/BacktestPage'

const Header = () => {
  const location = useLocation()
  const profileMatch = location.pathname.match(/^\/profiles\/([^/]+)/)
  const profileId = profileMatch?.[1] ?? null

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="brand" to="/">
          <span className="brand-mark">NF</span>
          <span className="brand-text">Naive Fortune</span>
        </Link>

        <nav className="primary-nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'nav-pill active' : 'nav-pill')}>
            Profiles
          </NavLink>
          <NavLink to="/summary" className={({ isActive }) => (isActive ? 'nav-pill active' : 'nav-pill')}>
            Global Summary
          </NavLink>
          <NavLink to="/profiles/new" className={({ isActive }) => (isActive ? 'nav-pill active' : 'nav-pill')}>
            New Profile
          </NavLink>
        </nav>
      </div>

      {profileId ? (
        <div className="subnav" role="navigation" aria-label="Profile Pages">
          <NavLink to={`/profiles/${profileId}`} end className={({ isActive }) => (isActive ? 'subnav-link active' : 'subnav-link')}>
            Dashboard
          </NavLink>
          <NavLink to={`/profiles/${profileId}/records`} className={({ isActive }) => (isActive ? 'subnav-link active' : 'subnav-link')}>
            Records
          </NavLink>
          <NavLink to={`/profiles/${profileId}/backtest`} className={({ isActive }) => (isActive ? 'subnav-link active' : 'subnav-link')}>
            Backtest
          </NavLink>
        </div>
      ) : null}
    </header>
  )
}

export default function App() {
  return (
    <div className="app-shell">
      <Header />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/profiles/new" element={<ProfileInitPage />} />
          <Route path="/profiles/:profileId" element={<ProfileDashboardPage />} />
          <Route path="/profiles/:profileId/records" element={<RecordsPage />} />
          <Route path="/profiles/:profileId/backtest" element={<BacktestPage />} />
          <Route path="/summary" element={<GlobalSummaryPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
