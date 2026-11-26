import { useState } from 'react'
import { gridLayout, singleFrameRatio } from './post-image-layout'

/**
 * HPD-175 (owner, 26 Nov 2026): the images of a post, laid out the way the LinkedIn feed shows them.
 * - 1 image: full width, in its own shape; a photo taller than 4:5 shows its top part in a 4:5 frame.
 * - 2 images: two equal tiles side by side.
 * - 3 images: one large tile on the left, two stacked on the right.
 * - 4 or more: one large tile on the left, three stacked on the right, "+N" on the last when there are more.
 * In the grid each tile is filled the way LinkedIn fills it; the saved image itself is always whole.
 */
export type GridImage = { key: string; url: string | null; alt: string }

function Tile({ image, index, className, more = 0 }: { image: GridImage; index: number; className: string; more?: number }) {
  return (
    <div className={`relative overflow-hidden bg-[var(--color-bg-soft-green)] ${className}`}>
      {image.url ? (
        <img src={image.url} alt={image.alt || `Image ${index + 1} attached to this post`} className="absolute inset-0 h-full w-full object-cover object-top" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center px-1 text-center text-xs text-[var(--color-text-secondary)]">
          Image {index + 1}: preview could not load, it is still posted
        </span>
      )}
      {more > 0 && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-3xl font-semibold text-white" aria-label={`${more} more images`}>
          +{more}
        </span>
      )}
    </div>
  )
}

/** One image: always full width. A photo taller than 4:5 keeps its top in view, so a head is never cut. */
function SingleImage({ url, alt }: { url: string; alt: string }) {
  const [ratio, setRatio] = useState<number | null>(null)
  return (
    <div className="relative w-full overflow-hidden bg-[var(--color-bg-soft-green)]" style={{ aspectRatio: ratio ?? 4 / 5 }}>
      <img src={url} alt={alt || 'Image attached to this post'}
        onLoad={(e) => setRatio(singleFrameRatio(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight))}
        className="absolute inset-0 h-full w-full object-cover object-top" />
    </div>
  )
}

export function PostImageGrid({ images }: { images: GridImage[] }) {
  if (images.length === 0) return null

  if (images.length === 1) {
    const [img] = images
    return img.url ? <SingleImage url={img.url} alt={img.alt} /> : <Tile image={img} index={0} className="aspect-[4/5] w-full" />
  }

  if (images.length === 2) {
    return (
      <div className="grid grid-cols-2 gap-0.5">
        {images.map((img, i) => <Tile key={img.key} image={img} index={i} className="aspect-[4/5]" />)}
      </div>
    )
  }

  const { tiles, more } = gridLayout(images.length)
  const side = images.slice(1, tiles)
  return (
    <div className={`grid aspect-square grid-cols-3 gap-0.5 ${side.length === 2 ? 'grid-rows-2' : 'grid-rows-3'}`}>
      <Tile image={images[0]} index={0} className={`col-span-2 ${side.length === 2 ? 'row-span-2' : 'row-span-3'}`} />
      {side.map((img, i) => (
        <Tile key={img.key} image={img} index={i + 1} className="" more={i === side.length - 1 ? more : 0} />
      ))}
    </div>
  )
}
