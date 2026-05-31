import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { exportAllData, importAllData } from '../db/exportImport'
import { deleteProfile, listProfiles } from '../features/profiles/repository'
import type { Profile } from '../types/models'

export const HomePage = () => {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

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
      const mode = window.confirm('确定覆盖现有数据吗？取消则使用追加导入。') ? 'overwrite' : 'append'
      const text = await file.text()
      await importAllData(JSON.parse(text), mode)
      setError('')
      await refresh()
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : '导入失败')
    }
  }

  return (
    <section>
      <div className="actions-row">
        <button onClick={() => navigate('/profiles/new')}>新建 Profile</button>
        <button onClick={handleExport}>导出数据</button>
        <button onClick={() => fileInputRef.current?.click()}>导入数据</button>
        <input ref={fileInputRef} hidden type="file" accept="application/json" onChange={onImportFile} />
      </div>
      {error && <p className="error">{error}</p>}

      {!hasProfiles ? <p>暂无 Profile，请先创建。</p> : null}
      <ul className="card-grid">
        {profiles.map((profile) => (
          <li key={profile.id} className="card">
            <h3>{profile.name}</h3>
            <p>市场：{profile.market.toUpperCase()}</p>
            <p>基准币种：{profile.baseCurrency}</p>
            <div className="actions-row">
              <Link to={`/profiles/${profile.id}`}>进入 Dashboard</Link>
              <button
                onClick={async () => {
                  if (window.confirm('确定删除该 profile 吗？')) {
                    await deleteProfile(profile.id)
                    await refresh()
                  }
                }}
              >
                删除
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
