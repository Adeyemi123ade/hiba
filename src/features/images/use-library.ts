import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { downloadImage, onlineLibraryPaths } from '@/features/content/api/image-service'
import {
  LOCAL_IMAGE_TYPES, addLocalImages, copiedServerPaths, keepLibrary, listLocalImages, type LocalImage,
} from '@/lib/local-images'

export const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-primary-dark)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50'
export const outlineBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-50'

export const libraryKey = (userId: string | undefined) => ['local-image-library', userId] as const

const copiedKey = (userId: string) => `hiba-online-images-copied-${userId}`

/**
 * Images uploaded before the library moved to the device are copied here once, quietly.
 * They stay online too, until the owner decides to remove them.
 */
async function copyOnlineImages(userId: string): Promise<number> {
  try {
    if (localStorage.getItem(copiedKey(userId))) return 0
  } catch { /* storage blocked: try anyway */ }
  const paths = await onlineLibraryPaths()
  const done = await copiedServerPaths(userId)
  let copied = 0
  let failed = false
  for (const path of paths) {
    if (done.has(path)) continue
    const blob = await downloadImage(path)
    if (!blob || !LOCAL_IMAGE_TYPES[blob.type]) { failed = failed || !blob; continue }
    try {
      await addLocalImages(userId, [{ blob, name: path.split('/').pop() ?? 'image', serverPath: path }])
      copied++
    } catch {
      failed = true
    }
  }
  if (!failed) {
    try { localStorage.setItem(copiedKey(userId), '1') } catch { /* runs again next time */ }
  }
  return copied
}

/** The person's library on this device, newest first. Shared by the Images page and the post picker. */
export function useLibrary(userId: string | undefined, enabled = true) {
  const queryClient = useQueryClient()
  const library = useQuery({
    queryKey: libraryKey(userId),
    queryFn: () => listLocalImages(userId!),
    enabled: enabled && Boolean(userId),
    staleTime: Infinity,
  })
  const started = useRef(false)
  useEffect(() => {
    if (!enabled || !userId || started.current) return
    started.current = true
    void keepLibrary()
    copyOnlineImages(userId)
      .then((n) => { if (n) void queryClient.invalidateQueries({ queryKey: libraryKey(userId) }) })
      .catch(() => undefined)
  }, [enabled, userId, queryClient])
  return library
}

/** Object links for thumbnails or full images; freed again when no longer shown. */
export function useBlobUrls(items: { id: string; blob: Blob }[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const key = items.map((i) => i.id).join(',')
  const list = useMemo(() => items, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const made: Record<string, string> = {}
    for (const i of list) made[i.id] = URL.createObjectURL(i.blob)
    setUrls(made)
    return () => { for (const u of Object.values(made)) URL.revokeObjectURL(u) }
  }, [list])
  return urls
}

export const thumbsOf = (images: LocalImage[] | undefined) => (images ?? []).map((i) => ({ id: i.id, blob: i.thumb }))
