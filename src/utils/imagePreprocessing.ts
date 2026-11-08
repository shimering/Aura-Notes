/**
 * Clean and normalize raw OCR recognized text strings.
 */
export function cleanRecognizedText(raw: string): string {
  if (!raw) return '';

  return raw
    .split('\n')
    .map((line) => {
      // Remove leading and trailing stray single non-alphanumeric chars often produced by OCR noise
      return line
        .replace(/^[\s|~_\-—]+/, '')
        .replace(/[\s|~_\-—]+$/, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    })
    .filter((line, index, arr) => {
      // Allow empty lines between paragraphs, but remove consecutive blank lines
      if (line === '' && arr[index - 1] === '') return false;
      return true;
    })
    .join('\n')
    .trim();
}

/**
 * Crops and enhances contrast of the canvas strokes for OCR engines.
 * Converts to high-contrast black ink on crisp white background.
 */
export function preprocessCanvasForOCR(
  sourceCanvas: HTMLCanvasElement,
  bbox?: { minX: number; minY: number; maxX: number; maxY: number } | null
): HTMLCanvasElement {
  const outputCanvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;

  let sx = 0;
  let sy = 0;
  let sw = sourceCanvas.width;
  let sh = sourceCanvas.height;

  if (bbox) {
    const pad = 24 * dpr;
    sx = Math.max(0, Math.floor(bbox.minX * dpr - pad));
    sy = Math.max(0, Math.floor(bbox.minY * dpr - pad));
    sw = Math.min(sourceCanvas.width - sx, Math.ceil((bbox.maxX - bbox.minX) * dpr + pad * 2));
    sh = Math.min(sourceCanvas.height - sy, Math.ceil((bbox.maxY - bbox.minY) * dpr + pad * 2));
  }

  outputCanvas.width = Math.max(64, sw);
  outputCanvas.height = Math.max(64, sh);

  const ctx = outputCanvas.getContext('2d');
  if (!ctx) return sourceCanvas;

  // Fill solid white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);

  // Draw source image onto the cropped canvas
  ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

  // Apply binarization / thresholding to make ink crisp black on white
  try {
    const imageData = ctx.getImageData(0, 0, outputCanvas.width, outputCanvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      // If pixel is semi-transparent or background white, push to pure white
      if (a < 50 || (r > 200 && g > 200 && b > 200)) {
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = 255;
      } else {
        // High contrast dark ink
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  } catch (e) {
    console.warn('Could not apply thresholding:', e);
  }

  return outputCanvas;
}
