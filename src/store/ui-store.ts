import { create } from 'zustand'

type Theme = 'light' | 'dark'

interface UiState {
  theme: Theme
  isSidebarOpen: boolean
  isModalOpen: boolean
  unreadNotificationCount: number
  setTheme: (theme: Theme) => void
  toggleSidebar: () => void
  setModalOpen: (open: boolean) => void
  setUnreadNotificationCount: (count: number) => void
}

/**
 * Global UI State (Zustand) — Front-end Architecture, section 3.
 * Scope: theme, sidebar, modal/dialog state, notification badge count.
 * User session and all server-backed data (profile, content, calendar,
 * analytics) live in TanStack Query, not here — see app/providers/query-client.ts.
 */
export const useUiStore = create<UiState>((set) => ({
  theme: 'light',
  isSidebarOpen: true,
  isModalOpen: false,
  unreadNotificationCount: 0,
  setTheme: (theme) => set({ theme }),
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setModalOpen: (isModalOpen) => set({ isModalOpen }),
  setUnreadNotificationCount: (unreadNotificationCount) => set({ unreadNotificationCount }),
}))
