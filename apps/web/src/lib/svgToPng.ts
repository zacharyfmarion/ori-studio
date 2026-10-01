/**
 * Rasterize a standalone SVG document through an offscreen canvas, at the pixel
 * size given. The image is scaled to the canvas whatever size the document
 * declares for itself, so a page in points rasterises at whatever density the
 * caller chose. Shared by the crease-pattern page, the folded-figure export and
 * the paper painter.
 */
export async function svgToPng(svg: string, width: number, height: number): Promise<Uint8Array> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Failed to render export SVG'));
    });
    image.src = url;
    await loaded;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas rendering is unavailable');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('Failed to encode export PNG'));
      }, 'image/png');
    });
    return new Uint8Array(await pngBlob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
