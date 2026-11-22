export type AttachChoice = 'device' | 'library' | 'video' | 'document'

/**
 * Which paperclip choices LinkedIn accepts for a post right now (HPD-160):
 * images (up to the limit), OR one video, OR one document. The rest are greyed out.
 */
export function attachChoices(imageCount: number, maxImages: number, hasAttachment: boolean): Record<AttachChoice, boolean> {
  const images = !hasAttachment && imageCount < maxImages
  const media = !hasAttachment && imageCount === 0
  return { device: images, library: images, video: media, document: media }
}
