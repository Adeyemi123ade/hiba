import { useQuery } from '@tanstack/react-query'
import { fetchLinkedInConnection } from '@/features/linkedin/linkedin-service'

export function useLinkedInConnection() {
  return useQuery({ queryKey: ['linkedin-connection'], queryFn: fetchLinkedInConnection, staleTime: 30_000 })
}
