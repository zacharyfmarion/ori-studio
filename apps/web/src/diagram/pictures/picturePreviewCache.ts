/** Screen-only bitmaps of the composed SVG. Exports always use the original vector. */
export interface PicturePreviewSize {
  width: number;
  height: number;
}

const MAX_PIXELS = 8 * 1024 * 1024;
const MAX_SIDE = 4096;
const CACHE_BYTES = 64 * 1024 * 1024;

/** Resolution buckets avoid repainting for every zoom tick; cap large paper and high DPI. */
export function picturePreviewSize(width: number, height: number, scale: number, dpr: number): PicturePreviewSize {
  const density = 2 ** Math.ceil(Math.log2(Math.max(0.5, scale * dpr)));
  const bounded = Math.min(density, MAX_SIDE / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)));
  return { width: Math.max(1, Math.floor(width * bounded)), height: Math.max(1, Math.floor(height * bounded)) };
}

interface Entry {
  size: PicturePreviewSize;
  bytes: number;
  promise: Promise<HTMLCanvasElement>;
  bitmap?: HTMLCanvasElement;
}

/**
 * One resolution per SVG, LRU bounded by pixels AND source bytes. The complete
 * image is the key: paper, pens, fonts, marks and drag omissions all invalidate
 * it, including edits which leave the page's packing signature unchanged.
 * A larger ready/in-flight preview also serves a smaller request.
 */
export class PicturePreviewCache {
  private entries = new Map<string, Entry>();
  private bytes = 0;

  constructor(
    private rasterize: (src: string, size: PicturePreviewSize) => Promise<HTMLCanvasElement>,
    private maxBytes = CACHE_BYTES
  ) {}

  ready(src: string, size: PicturePreviewSize): HTMLCanvasElement | null {
    const entry = this.entries.get(src);
    return entry && entry.size.width >= size.width && entry.size.height >= size.height ? entry.bitmap ?? null : null;
  }

  get(src: string, size: PicturePreviewSize): Promise<HTMLCanvasElement> {
    const previous = this.entries.get(src);
    if (previous && previous.size.width >= size.width && previous.size.height >= size.height) {
      this.entries.delete(src);
      this.entries.set(src, previous);
      return previous.promise;
    }
    if (previous) this.remove(src, previous);
    const entry: Entry = { size, bytes: size.width * size.height * 4 + src.length * 2, promise: this.rasterize(src, size) };
    // A single oversized source may be displayed, but must not pin the cache.
    if (entry.bytes <= this.maxBytes) {
      for (const [oldSrc, old] of this.entries) {
        if (this.bytes + entry.bytes <= this.maxBytes) break;
        this.remove(oldSrc, old);
      }
      this.entries.set(src, entry);
      this.bytes += entry.bytes;
    }
    void entry.promise.then((bitmap) => { entry.bitmap = bitmap; }, () => {
      if (this.entries.get(src) === entry) this.remove(src, entry);
    });
    return entry.promise;
  }

  private remove(src: string, entry: Entry): void {
    this.entries.delete(src);
    this.bytes -= entry.bytes;
  }
}

/** Keep the SVG in an image's isolated document, just as the existing preview does. */
function rasterize(src: string, size: PicturePreviewSize): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Picture preview canvas unavailable');
        // Cards have square wells; preserve the source's proportions just as
        // object-fit: contain does. Pages already request their exact aspect.
        const scale = Math.min(size.width / image.naturalWidth, size.height / image.naturalHeight);
        const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
        context.drawImage(image, (size.width - width) / 2, (size.height - height) / 2, width, height);
        resolve(canvas);
      } catch (error) {
        reject(error);
      } finally {
        image.onload = null;
        image.onerror = null;
        image.src = '';
      }
    };
    image.onerror = () => reject(new Error('Picture preview image could not load'));
    image.src = src;
  });
}

export const picturePreviewCache = new PicturePreviewCache(rasterize);
