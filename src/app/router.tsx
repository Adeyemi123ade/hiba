import { createBrowserRouter, Navigate } from 'react-router-dom'
import { DashboardLayout } from '@/app/layouts/dashboard-layout'
import { LandingPage } from '@/app/routes/landing-page'
import { NotFoundPage } from '@/app/routes/not-found-page'
import { ProfilePage } from '@/app/routes/profile-page'
import { AuthPage } from '@/features/auth/auth-page'
import { RequireAuth, RequireOnboarded } from '@/features/auth/guards/route-guards'
import { OnboardingPage } from '@/features/onboarding/onboarding-page'
import { PrivacyPage, TermsPage } from '@/features/legal/legal-page'
import { AuthCallbackPage } from '@/features/auth/auth-callback-page'
import { DashboardHomePage } from '@/features/dashboard/dashboard-home-page'
import { CapturePage } from '@/features/capture/capture-page'
import { CalendarPage } from '@/features/calendar/calendar-page'
import { LibraryPage } from '@/features/library/library-page'
import { ImagesPage } from '@/features/images/images-page'
import { AssistantPage } from '@/features/assistant/assistant-page'
import { SettingsPage } from '@/features/settings/settings-page'

// Route map — Front-end Architecture, section 2 (Routing Structure).
export const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  { path: '/auth', element: <AuthPage /> },
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  { path: '/terms', element: <TermsPage /> },
  { path: '/privacy', element: <PrivacyPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/onboarding', element: <OnboardingPage /> },
      {
        element: <RequireOnboarded />,
        children: [
          {
            path: '/dashboard',
            element: <DashboardLayout />,
            children: [
              { index: true, element: <Navigate to="home" replace /> },
              { path: 'home', element: <DashboardHomePage /> },
              { path: 'capture', element: <CapturePage /> },
              { path: 'calendar', element: <CalendarPage /> },
              { path: 'library', element: <LibraryPage /> },
              { path: 'images', element: <ImagesPage /> },
              { path: 'assistant', element: <AssistantPage /> },
              { path: 'settings/*', element: <SettingsPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '/profile/:id', element: <ProfilePage /> },
  { path: '/not-found', element: <NotFoundPage /> },
  { path: '*', element: <NotFoundPage /> },
])
