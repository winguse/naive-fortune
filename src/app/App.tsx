import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { HomePage } from '../pages/HomePage'
import { ProfileInitPage } from '../pages/ProfileInitPage'
import { ProfileDashboardPage } from '../pages/ProfileDashboardPage'
import { RecordsPage } from '../pages/RecordsPage'
import { GlobalSummaryPage } from '../pages/GlobalSummaryPage'
import { BacktestPage } from '../pages/BacktestPage'

const Header = () => (
  <header className="topbar">
    <h1>Naive Fortune</h1>
    <nav>
      <Link to="/">Profiles</Link>
      <Link to="/summary">Global Summary</Link>
    </nav>
  </header>
)

export default function App() {
  return (
    <div className="app-shell">
      <Header />
      <main>
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
