import { describe, expect, it } from 'vitest'
import { attachChoices } from './attachment-choices'

describe('paperclip choices', () => {
  it('offers everything on an empty post', () => {
    expect(attachChoices(0, 9, false)).toEqual({ device: true, library: true, video: true, document: true })
  })
  it('greys out video and document once the post has images', () => {
    expect(attachChoices(2, 9, false)).toEqual({ device: true, library: true, video: false, document: false })
  })
  it('greys out images when the post is full', () => {
    expect(attachChoices(9, 9, false)).toEqual({ device: false, library: false, video: false, document: false })
  })
  it('greys out everything when a video or document is attached (Replace is on its card)', () => {
    expect(attachChoices(0, 9, true)).toEqual({ device: false, library: false, video: false, document: false })
  })
})
