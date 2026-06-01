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
      expect(screen.getByText('暂无 Profile，请先创建。')).toBeTruthy()
    })
  })
})
