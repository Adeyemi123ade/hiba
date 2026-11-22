/**
 * The Images library lives on this device only (owner decision, 22 Nov 2026).
 * Files are kept in the browser's IndexedDB: never sent to Supabase, no limit beyond the device's space.
 * Images put on a post are uploaded separately (image-service.ts), because scheduled posts are sent
 * by the server while this device may be off.
 */

const DB_NAME = 'hiba-images'
const DB_VERSION = 1
const META = 'meta'
const FILES = 'files'

export const LOCAL_IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' }
const THUMB_MAX = 480

/** What the gallery needs to show an image. The full file is read only when it is opened or used. */
export interface LocalImage {
  id: string
  userId: string
  name: string
  type: string
  bytes: number
  width: number | null
  height: number | null
  createdAt: number
  thumb: Blob
  /** Set when the image was copied from the old online library, so it is not copied twice. */
  serverPath?: string
}

export type LocalImageErrorCode = 'unavailable' | 'quota' | 'type' | 'corrupt' | 'missing'

export const LOCAL_IMAGE_ERROR_TEXT: Record<LocalImageErrorCode, string> = {
  unavailable: 'This browser is not letting Hiba save images on this device. Private browsing can do this. Try a normal window.',
  quota: 'This device is out of space for images. Delete some images from your library, or free up space, then try again.',
  type: 'Please choose JPG, PNG or GIF images.',
  corrupt: 'One of the images could not be opened. It may be damaged. Please choose a different one.',
  missing: 'That image is no longer on this device.',
}

export class LocalImageError extends Error {
  readonly code: LocalImageErrorCode
  constructor(code: LocalImageErrorCode) {
    super(code)
    this.code = code
  }
}

export type Thumbnailer = (file: Blob) => Promise<{ thumb: Blob; width: number; height: number }>

let dbPromise: Promise<IDBDatabase> | null = null

function isQuota(e: unknown) {
  const name = (e as { name?: string } | null)?.name
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest
    try {
      if (typeof indexedDB === 'undefined') throw new Error('no indexedDB')
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      reject(new LocalImageError('unavailable'))
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' }).createIndex('byUser', 'userId')
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'id' })
    }
    req.onsuccess = () => {
      const db = req.result
      // Another tab upgraded the database: close so it can, and reopen next time.
      db.onversionchange = () => { db.close(); dbPromise = null }
      resolve(db)
    }
    req.onerror = () => reject(new LocalImageError(isQuota(req.error) ? 'quota' : 'unavailable'))
    req.onblocked = () => reject(new LocalImageError('unavailable'))
  }).catch((e) => {
    dbPromise = null
    throw e
  })
  return dbPromise
}

/** Runs one transaction and resolves when it is committed (not just when the requests succeed). */
async function tx<T>(stores: string[], mode: IDBTransactionMode, work: (t: IDBTransaction) => T): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    let t: IDBTransaction
    try {
      t = db.transaction(stores, mode)
    } catch (e) {
      reject(new LocalImageError(isQuota(e) ? 'quota' : 'unavailable'))
      return
    }
    let result: T
    t.oncomplete = () => resolve(result)
    t.onabort = t.onerror = () => reject(new LocalImageError(isQuota(t.error) ? 'quota' : 'unavailable'))
    try {
      result = work(t)
    } catch (e) {
      try { t.abort() } catch { /* already finished */ }
      reject(new LocalImageError(isQuota(e) ? 'quota' : 'unavailable'))
    }
  })
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

/** A small JPEG for the grid, so scrolling a big library stays fast. Fails for damaged files. */
export const browserThumbnailer: Thumbnailer = async (file) => {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, THUMB_MAX / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.fillStyle = '#ffffff' // transparent PNG/GIF areas show white, not black
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    const thumb = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.8))
    if (!thumb) throw new Error('no thumbnail')
    return { thumb, width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}

/** The person's images on this device, newest first. */
export async function listLocalImages(userId: string): Promise<LocalImage[]> {
  const rows = await tx([META], 'readonly', (t) => request(t.objectStore(META).index('byUser').getAll(userId) as IDBRequest<LocalImage[]>))
  return (await rows).sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Saves files to the library on this device. All or nothing: every file is checked and
 * thumbnailed first, then all are written in one transaction.
 */
export async function addLocalImages(
  userId: string,
  files: (File | { blob: Blob; name: string; serverPath?: string })[],
  thumbnailer: Thumbnailer = browserThumbnailer,
): Promise<LocalImage[]> {
  const now = Date.now()
  const prepared: { meta: LocalImage; blob: Blob }[] = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const blob = f instanceof Blob ? f : f.blob
    if (!LOCAL_IMAGE_TYPES[blob.type]) throw new LocalImageError('type')
    let shape: Awaited<ReturnType<Thumbnailer>>
    try {
      shape = await thumbnailer(blob)
    } catch {
      throw new LocalImageError('corrupt')
    }
    prepared.push({
      blob,
      meta: {
        id: crypto.randomUUID(),
        userId,
        name: (f instanceof File ? f.name : 'name' in f ? f.name : '') || `image.${LOCAL_IMAGE_TYPES[blob.type]}`,
        type: blob.type,
        bytes: blob.size,
        width: shape.width,
        height: shape.height,
        // Later files in one batch count as newer, so the order picked is kept at the top.
        createdAt: now + i,
        thumb: shape.thumb,
        ...(!(f instanceof Blob) && f.serverPath ? { serverPath: f.serverPath } : {}),
      },
    })
  }
  if (!prepared.length) return []
  await tx([META, FILES], 'readwrite', (t) => {
    for (const p of prepared) {
      t.objectStore(FILES).put({ id: p.meta.id, blob: p.blob })
      t.objectStore(META).put(p.meta)
    }
  })
  return prepared.map((p) => p.meta)
}

/** The original file, ready to upload to a post. */
export async function getLocalFile(id: string): Promise<File> {
  const [meta, row] = await tx([META, FILES], 'readonly', (t) => Promise.all([
    request(t.objectStore(META).get(id) as IDBRequest<LocalImage | undefined>),
    request(t.objectStore(FILES).get(id) as IDBRequest<{ id: string; blob: Blob } | undefined>),
  ]))
  if (!meta || !row) throw new LocalImageError('missing')
  return new File([row.blob], meta.name, { type: meta.type })
}

/** Deletes images from this device. Posts already on LinkedIn are not affected. */
export async function deleteLocalImages(ids: string[]): Promise<void> {
  if (!ids.length) return
  await tx([META, FILES], 'readwrite', (t) => {
    for (const id of ids) {
      t.objectStore(META).delete(id)
      t.objectStore(FILES).delete(id)
    }
  })
}

/** Online-library paths already copied to this device. */
export async function copiedServerPaths(userId: string): Promise<Set<string>> {
  const rows = await listLocalImages(userId)
  return new Set(rows.map((r) => r.serverPath).filter((p): p is string => Boolean(p)))
}

/**
 * Asks the browser not to clear the library when space runs low. Browsers may say no; the page
 * warns the person either way. Safe to call often.
 */
export async function keepLibrary(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

/** For tests: forget the open connection. */
export function resetLocalImagesForTests() {
  dbPromise = null
}
