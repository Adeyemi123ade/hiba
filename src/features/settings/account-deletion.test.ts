import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A pretend Supabase: two buckets of files, an account, and a record of every call.
const state = vi.hoisted(() => ({
  files: {} as Record<string, string[]>,
  calls: [] as string[],
  failList: false,
  failRpc: false,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        list: async (folder: string, { limit, offset }: { limit: number; offset: number }) => {
          state.calls.push(`list ${bucket}/${folder}`)
          if (state.failList) return { data: null, error: new Error('offline') }
          const names = (state.files[bucket] ?? []).filter((p) => p.startsWith(`${folder}/`)).map((p) => p.slice(folder.length + 1))
          return { data: names.slice(offset, offset + limit).map((name) => ({ id: name, name })), error: null }
        },
        remove: async (paths: string[]) => {
          state.calls.push(`remove ${bucket} ${paths.length}`)
          state.files[bucket] = (state.files[bucket] ?? []).filter((p) => !paths.includes(p))
          return { data: [], error: null }
        },
      }),
    },
    rpc: async (name: string) => {
      state.calls.push(`rpc ${name}`)
      return { data: null, error: state.failRpc ? new Error('failed') : null }
    },
    auth: { signOut: async () => { state.calls.push('signOut') ; return { error: null } } },
  },
}))

import { AccountDeletionError, clearDeviceData, deleteMyAccount, deleteMyFiles, emailMatches } from './account-deletion'
import { addLocalImages, listLocalImages, resetLocalImagesForTests, type Thumbnailer } from '@/lib/local-images'

class MemoryStorage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}

const thumb: Thumbnailer = async () => ({ thumb: new Blob(['t'], { type: 'image/jpeg' }), width: 10, height: 10 })
const png = (name: string) => new File(['x'], name, { type: 'image/png' })
const A = 'aaaaaaaa-0000-0000-0000-000000000001'
const B = 'bbbbbbbb-0000-0000-0000-000000000002'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  resetLocalImagesForTests()
  vi.stubGlobal('window', { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() })
  state.files = {
    'post-images': [`${A}/1.png`, `${A}/2.jpg`, `${B}/other.png`],
    'post-media': [`${A}/talk.mp4`, `${B}/deck.pdf`],
  }
  state.calls = []
  state.failList = false
  state.failRpc = false
})

describe('delete my account', () => {
  it('only accepts the account email, ignoring case and spaces', () => {
    expect(emailMatches('  Ade@Example.com ', 'ade@example.com')).toBe(true)
    expect(emailMatches('someone@else.com', 'ade@example.com')).toBe(false)
    expect(emailMatches('', undefined)).toBe(false)
  })

  it("deletes all of this person's files in both buckets and nobody else's", async () => {
    expect(await deleteMyFiles(A)).toBe(3)
    expect(state.files['post-images']).toEqual([`${B}/other.png`])
    expect(state.files['post-media']).toEqual([`${B}/deck.pdf`])
  })

  it('deletes files first, then the account, then signs out', async () => {
    await deleteMyAccount(A)
    expect(state.calls.filter((c) => !c.startsWith('list'))).toEqual([
      'remove post-images 2', 'remove post-media 1', 'rpc delete_my_account', 'signOut',
    ])
  })

  it('stops before touching the account if the files cannot be deleted', async () => {
    state.failList = true
    await expect(deleteMyAccount(A)).rejects.toEqual(new AccountDeletionError('files'))
    expect(state.calls).not.toContain('rpc delete_my_account')
    expect(state.calls).not.toContain('signOut')
  })

  it('reports a failed account deletion and stays signed in so the person can retry', async () => {
    state.failRpc = true
    await expect(deleteMyAccount(A)).rejects.toMatchObject({ step: 'account' })
    expect(state.calls).not.toContain('signOut')
  })

  it("clears this person's image library and saved drafts on the device, and keeps another person's library", async () => {
    await addLocalImages(A, [png('mine.png')], thumb)
    await addLocalImages(B, [png('theirs.png')], thumb)
    const w = window as unknown as { localStorage: Storage; sessionStorage: Storage }
    w.sessionStorage.setItem(`hiba:capture-draft:${A}`, '{"text":"idea"}')
    w.localStorage.setItem(`hiba-online-images-copied-${A}`, '1')
    w.localStorage.setItem('sb-project-auth-token', 'kept for the sign-in library')

    await clearDeviceData(A)

    expect(await listLocalImages(A)).toHaveLength(0)
    expect(await listLocalImages(B)).toHaveLength(1)
    expect(w.sessionStorage.length).toBe(0)
    expect(w.localStorage.getItem(`hiba-online-images-copied-${A}`)).toBeNull()
    expect(w.localStorage.getItem('sb-project-auth-token')).not.toBeNull()
  })
})
