import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { exportAllData, importAllData } from '../db/exportImport'
import { db } from '../db/database'
import { deleteProfile, listProfiles } from '../features/profiles/repository'
import { isZh } from '../i18n/language'
import type { Profile } from '../types/models'

export const HomePage = () => {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [error, setError] = useState('')
  const [pendingClearAllConfirm, setPendingClearAllConfirm] = useState(false)
  const [pendingDeleteProfileId, setPendingDeleteProfileId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const text = isZh
    ? {
        newProfile: '新建组合',
        exportData: '导出数据',
        importData: '导入数据（默认增量）',
        clearData: '清空数据',
        confirmClearData: '确认清空数据',
        importFail: '导入失败',
        clearDataFail: '清空数据失败',
        empty: '暂无组合，请先创建。',
        market: '市场',
        currency: '基准币种',
        confirmDelete: '确认删除',
        cancel: '取消',
        delete: '删除',
        clearDataHint: '此操作会删除所有组合、持仓、交易、回测和策略数据。',
      }
    : {
        newProfile: 'New Profile',
        exportData: 'Export Data',
        importData: 'Import Data (append mode)',
        clearData: 'Clear Data',
        confirmClearData: 'Confirm Clear Data',
        importFail: 'Import failed',
        clearDataFail: 'Failed to clear data',
        empty: 'No profiles yet. Create one to get started.',
        market: 'Market',
        currency: 'Base Currency',
        confirmDelete: 'Confirm Delete',
        cancel: 'Cancel',
        delete: 'Delete',
        clearDataHint: 'This deletes all profiles, holdings, trades, backtests, and strategy data.',
      }

  const refresh = async () => setProfiles(await listProfiles())

  useEffect(() => {
    void refresh()
  }, [])

  const hasProfiles = useMemo(() => profiles.length > 0, [profiles])

  const handleExport = async () => {
    const data = await exportAllData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `naive-fortune-export-${Date.now()}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const onImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      await importAllData(JSON.parse(text), 'append')
      setError('')
      await refresh()
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : text.importFail)
    } finally {
      event.target.value = ''
    }
  }

  const clearAllData = async () => {
    try {
      await db.transaction(
        'rw',
        [
          db.profiles,
          db.initialHoldings,
          db.cashflows,
          db.trades,
          db.targetAllocations,
          db.strategyConfigs,
          db.backtestConfigs,
        ],
        async () => {
          await db.backtestConfigs.clear()
          await db.strategyConfigs.clear()
          await db.targetAllocations.clear()
          await db.trades.clear()
          await db.cashflows.clear()
          await db.initialHoldings.clear()
          await db.profiles.clear()
        },
      )
      setPendingClearAllConfirm(false)
      setPendingDeleteProfileId(null)
      setError('')
      await refresh()
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : text.clearDataFail)
    }
  }

  return (
    <section>
      <div className="actions-row">
        <button onClick={() => navigate('/profiles/new')}>{text.newProfile}</button>
        <button onClick={handleExport}>{text.exportData}</button>
        <button onClick={() => fileInputRef.current?.click()}>
          {text.importData}
        </button>
        {pendingClearAllConfirm ? (
          <>
            <button onClick={() => void clearAllData()}>{text.confirmClearData}</button>
            <button onClick={() => setPendingClearAllConfirm(false)}>{text.cancel}</button>
          </>
        ) : (
          <button onClick={() => setPendingClearAllConfirm(true)}>{text.clearData}</button>
        )}
        <input ref={fileInputRef} hidden type="file" accept="application/json" onChange={onImportFile} />
      </div>
      {pendingClearAllConfirm ? <p className="error">{text.clearDataHint}</p> : null}
      {error && <p className="error">{error}</p>}

      {!hasProfiles ? <p>{text.empty}</p> : null}
      <ul className="card-grid">
        {profiles.map((profile) => (
          <li
            key={profile.id}
            className="card"
            role="button"
            tabIndex={0}
            onClick={() => navigate(`/profiles/${profile.id}`)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                navigate(`/profiles/${profile.id}`)
              }
            }}
          >
            <h3>{profile.name}</h3>
            <p>{text.market}: {profile.market.toUpperCase()}</p>
            <p>{text.currency}: {profile.baseCurrency}</p>
            <div className="actions-row">
              {pendingDeleteProfileId === profile.id ? (
                <>
                  <button
                    onClick={async (event) => {
                      event.stopPropagation()
                      await deleteProfile(profile.id)
                      setPendingDeleteProfileId(null)
                      await refresh()
                    }}
                  >
                    {text.confirmDelete}
                  </button>
                  <button onClick={(event) => {
                    event.stopPropagation()
                    setPendingDeleteProfileId(null)
                  }}>{text.cancel}</button>
                </>
              ) : (
                <button onClick={(event) => {
                  event.stopPropagation()
                  setPendingDeleteProfileId(profile.id)
                }}>{text.delete}</button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
