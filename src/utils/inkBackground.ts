import { InkBackground } from '../types/note';

/**
 * Draws a page style onto a dedicated background canvas. Kept separate from the
 * ink canvas so eraser strokes (destination-out) never punch holes in the ruling.
 *
 * Coordinates are device pixels; `scale` is the device pixel ratio.
 */
export function drawInkBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number,
  background: InkBackground
): void {
  if (background === 'none' || width <= 0 || height <= 0) return;

  const step = 32 * scale;
  ctx.save();
  ctx.strokeStyle = 'rgba(100, 116, 139, 0.22)';
  ctx.fillStyle = 'rgba(100, 116, 139, 0.38)';
  ctx.lineWidth = Math.max(1, scale * 0.75);

  if (background === 'ruled') {
    ctx.beginPath();
    for (let y = step; y <= height; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  } else if (background === 'grid') {
    ctx.beginPath();
    for (let x = 0; x <= width; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y <= height; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  } else if (background === 'dotted') {
    const radius = Math.max(1.2, scale * 1.2);
    for (let x = step; x <= width; x += step) {
      for (let y = step; y <= height; y += step) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  ctx.restore();
}

export const INK_BACKGROUNDS: { id: InkBackground; label: string }[] = [
  { id: 'none', label: 'Blank' },
  { id: 'ruled', label: 'Ruled' },
  { id: 'grid', label: 'Grid' },
  { id: 'dotted', label: 'Dotted' }
];
