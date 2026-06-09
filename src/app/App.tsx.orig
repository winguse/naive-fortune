import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { isZh } from '../i18n/language'
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
  const text = isZh
    ? {
        profileList: '组合列表',
        globalSummary: '全局汇总',
        newProfile: '新建组合',
        dashboard: '仪表盘',
        records: '记录',
        backtest: '回测',
      }
    : {
        profileList: 'Profiles',
        globalSummary: 'Global Summary',
        newProfile: 'New Profile',
        dashboard: 'Dashboard',
        records: 'Records',
        backtest: 'Backtest',
      }

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="brand" to="/">
          <span className="brand-mark">NF</span>
          <span className="brand-text">Naive Fortune</span>
        </Link>

        <nav className="primary-nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'nav-pill active' : 'nav-pill')}>
            {text.profileList}
          </NavLink>
          <NavLink to="/summary" className={({ isActive }) => (isActive ? 'nav-pill active' : 'nav-pill')}>
            {text.globalSummary}
          </NavLink>
          <NavLink to="/profiles/new" className={({ isActive }) => (isActive ? 'nav-pill active' : 'nav-pill')}>
            {text.newProfile}
          </NavLink>
        </nav>
      </div>

      {profileId ? (
        <div className="subnav" role="navigation" aria-label="Profile Pages">
          <NavLink to={`/profiles/${profileId}`} end className={({ isActive }) => (isActive ? 'subnav-link active' : 'subnav-link')}>
            {text.dashboard}
          </NavLink>
          <NavLink to={`/profiles/${profileId}/records`} className={({ isActive }) => (isActive ? 'subnav-link active' : 'subnav-link')}>
            {text.records}
          </NavLink>
          <NavLink to={`/profiles/${profileId}/backtest`} className={({ isActive }) => (isActive ? 'subnav-link active' : 'subnav-link')}>
            {text.backtest}
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
