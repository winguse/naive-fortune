import { MemoryRouter } from 'react-router-dom'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HomePage } from './HomePage'

vi.mock('../features/profiles/repository', () => ({
  listProfiles: vi.fn().mockResolvedValue([]),
  deleteProfile: vi.fn(),
}))

vi.mock('../db/exportImport', () => ({
  exportAllData: vi.fn(),
  importAllData: vi.fn(),
}))

describe('HomePage', () => {
  it('renders empty state for profile list', async () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      const zhText = screen.queryByText('暂无组合，请先创建。')
      const enText = screen.queryByText('No profiles yet. Create one to get started.')
      expect(Boolean(zhText || enText)).toBe(true)
    })
  })
})
