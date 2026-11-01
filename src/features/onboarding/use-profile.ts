import { useQuery } from '@tanstack/react-query'
import { fetchMyProfile } from '@/features/onboarding/api/onboarding-service'

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ['profile', userId],
    queryFn: () => fetchMyProfile(userId as string),
    enabled: Boolean(userId),
  })
}
