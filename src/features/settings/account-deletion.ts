import { supabase } from '@/lib/supabase'
import { IMAGE_BUCKET } from '@/features/content/api/image-service'
import { MEDIA_BUCKET } from '@/features/content/api/media-service'
import { deleteLocalImages, listLocalImages } from '@/lib/local-images'

/**
 * Delete my account (HPD-157). Owner decision, 22 Nov 2026: once deleted, everything goes.
 *
 * 1. Files first: Supabase does not let SQL delete storage files. If this fails we stop,
 *    the account is untouched, and trying again is safe.
 * 2. Then the account: delete_my_account() (migration 0021) deletes the sign-in account of the
 *    caller, and every table cascades from it.
 * 3. Then this device: the image library and anything Hiba saved in the browser for this person.
 */

export type DeleteStep = 'files' | 'account'

export class AccountDeletionError extends Error {
  step: DeleteStep
  constructor(step: DeleteStep) {
    super(step)
    this.step = step
    this.name = 'AccountDeletionError'
  }
}

export const DELETE_ERROR_TEXT: Record<DeleteStep, string> = {
  files: 'Your files could not be deleted, so your account has not been deleted. Check your connection and try again.',
  account: 'Your account could not be deleted. Your files are already gone. Check your connection and try again.',
}

/** The typed email must match the account's email, ignoring case and spaces at the ends. */
export const emailMatches = (typed: string, email: string | undefined) =>
  Boolean(email) && typed.trim().toLowerCase() === email!.trim().toLowerCase()

const PAGE = 1000

/** Every file in this person's folder of one bucket (folders hold files directly: <user id>/<file>). */
async function listFolder(bucket: string, userId: string): Promise<string[]> {
  const paths: string[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage.from(bucket).list(userId, { limit: PAGE, offset })
    if (error) throw error
    const files = (data ?? []).filter((f) => f.id) // folders have no id
    paths.push(...files.map((f) => `${userId}/${f.name}`))
    if ((data ?? []).length < PAGE) return paths
  }
}

/** Deletes every file this person has in Hiba's storage. Safe to run again. */
export async function deleteMyFiles(userId: string): Promise<number> {
  let removed = 0
  for (const bucket of [IMAGE_BUCKET, MEDIA_BUCKET]) {
    const paths = await listFolder(bucket, userId)
    for (let i = 0; i < paths.length; i += PAGE) {
      const { error } = await supabase.storage.from(bucket).remove(paths.slice(i, i + PAGE))
      if (error) throw error
    }
    removed += paths.length
  }
  return removed
}

/** Clears what Hiba kept on this device for this person: the image library and saved drafts. */
export async function clearDeviceData(userId: string): Promise<void> {
  try {
    const images = await listLocalImages(userId)
    if (images.length) await deleteLocalImages(images.map((i) => i.id))
  } catch { /* storage unavailable: nothing to clear */ }
  for (const store of [safeStorage('localStorage'), safeStorage('sessionStorage')]) {
    if (!store) continue
    const keys: string[] = []
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (k && (k.includes(userId) || k.startsWith('hiba'))) keys.push(k)
    }
    for (const k of keys) store.removeItem(k)
  }
}

function safeStorage(name: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    return window[name]
  } catch {
    return null
  }
}

/** Deletes the signed-in person's account and everything in it, then signs them out on this device. */
export async function deleteMyAccount(userId: string): Promise<void> {
  try {
    await deleteMyFiles(userId)
  } catch {
    throw new AccountDeletionError('files')
  }
  const { error } = await supabase.rpc('delete_my_account')
  if (error) throw new AccountDeletionError('account')
  await clearDeviceData(userId)
  // The account no longer exists, so only this device's session needs clearing.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
}
