import { useQuery } from '@tanstack/react-query'
import { fetchLibrary, previewUrls } from '@/features/content/api/image-service'

export const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-primary-dark)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50'
export const outlineBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-50'

export const LIBRARY_KEY = ['image-library'] as const

/** The person's library with private preview links, shared by the Images page and the picker. */
export function useLibrary(enabled = true) {
  const library = useQuery({ queryKey: LIBRARY_KEY, queryFn: fetchLibrary, enabled })
  const paths = (library.data?.images ?? []).map((i) => i.path)
  const thumbs = useQuery({
    queryKey: ['image-library-thumbs', paths],
    queryFn: () => previewUrls(paths),
    enabled: enabled && paths.length > 0,
    staleTime: 50 * 60 * 1000,
  })
  return { library, thumbs: thumbs.data ?? {} }
}

