import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LocalImageError, addLocalImages, copiedServerPaths, deleteLocalImages, getLocalFile, listLocalImages,
  resetLocalImagesForTests, type Thumbnailer,
} from './local-images'

const thumb: Thumbnailer = async () => ({ thumb: new Blob(['t'], { type: 'image/jpeg' }), width: 800, height: 600 })
const broken: Thumbnailer = async () => { throw new Error('cannot decode') }
const png = (name: string, body = 'x') => new File([body], name, { type: 'image/png' })

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory() // a fresh, empty device for every test
  resetLocalImagesForTests()
})
afterEach(() => vi.restoreAllMocks())

describe('local image library', () => {
  it('keeps images between sessions, newest first, per person', async () => {
    await addLocalImages('u1', [png('a.png')], thumb)
    await new Promise((r) => setTimeout(r, 5))
    await addLocalImages('u1', [png('b.png'), png('c.png')], thumb)
    await addLocalImages('u2', [png('other.png')], thumb)

    resetLocalImagesForTests() // like closing and reopening the app
    const list = await listLocalImages('u1')
    expect(list.map((i) => i.name)).toEqual(['c.png', 'b.png', 'a.png'])
    expect(list[0]).toMatchObject({ userId: 'u1', type: 'image/png', width: 800, height: 600 })
    expect((await listLocalImages('u2')).map((i) => i.name)).toEqual(['other.png'])
  })

  it('returns the original file for posting', async () => {
    const [saved] = await addLocalImages('u1', [png('photo.png', 'original-bytes')], thumb)
    const file = await getLocalFile(saved.id)
    expect(file.name).toBe('photo.png')
    expect(file.type).toBe('image/png')
    expect(await file.text()).toBe('original-bytes')
  })

  it('refuses unsupported formats and damaged files, saving nothing from the batch', async () => {
    await expect(addLocalImages('u1', [png('ok.png'), new File(['x'], 'a.webp', { type: 'image/webp' })], thumb))
      .rejects.toMatchObject({ code: 'type' })
    await expect(addLocalImages('u1', [png('ok.png'), png('bad.png')], async (b) => {
      if ((await b.text()) === 'x' && (b as File).name === 'bad.png') throw new Error('bad')
      return thumb(b)
    })).rejects.toMatchObject({ code: 'corrupt' })
    await expect(addLocalImages('u1', [png('bad.png')], broken)).rejects.toBeInstanceOf(LocalImageError)
    expect(await listLocalImages('u1')).toEqual([])
  })

  it('deletes one image, or several at once', async () => {
    const saved = await addLocalImages('u1', [png('a.png'), png('b.png'), png('c.png'), png('d.png')], thumb)
    await deleteLocalImages([saved[0].id])
    expect((await listLocalImages('u1')).map((i) => i.name)).toEqual(['d.png', 'c.png', 'b.png'])
    await deleteLocalImages([saved[1].id, saved[3].id])
    expect((await listLocalImages('u1')).map((i) => i.name)).toEqual(['c.png'])
    await expect(getLocalFile(saved[0].id)).rejects.toMatchObject({ code: 'missing' })
  })

  it('reports a full device plainly and saves nothing', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    await expect(addLocalImages('u1', [png('a.png')], thumb)).rejects.toMatchObject({ code: 'quota' })
    vi.restoreAllMocks()
    expect(await listLocalImages('u1')).toEqual([])
  })

  it('remembers which online images were already copied', async () => {
    await addLocalImages('u1', [{ blob: new Blob(['x'], { type: 'image/jpeg' }), name: 'old.jpg', serverPath: 'u1/old.jpg' }], thumb)
    expect([...(await copiedServerPaths('u1'))]).toEqual(['u1/old.jpg'])
  })

  it('says so when the browser blocks storage', async () => {
    // @ts-expect-error simulate a browser without IndexedDB
    delete globalThis.indexedDB
    resetLocalImagesForTests()
    await expect(listLocalImages('u1')).rejects.toMatchObject({ code: 'unavailable' })
  })
})
