import { InkBackground } from '../types/note';

/** Page ruling styles. Drawing is handled by CSS so the pattern stays sharp at every zoom. */
export const INK_BACKGROUNDS: { id: InkBackground; label: string }[] = [
  { id: 'none', label: 'Blank' },
  { id: 'ruled', label: 'Ruled' },
  { id: 'grid', label: 'Grid' },
  { id: 'dotted', label: 'Dotted' }
];

/**
 * Quiet, desaturated surfaces for note pages and the endless canvas. An empty
 * value keeps the default paper (A4) or transparent canvas and its dotted desk.
 */
export const PAGE_COLORS: { value?: string; label: string }[] = [
  { value: undefined, label: 'Desk (default)' },
  { value: '#faf7f0', label: 'Ivory' },
  { value: '#f0e9dd', label: 'Sand' },
  { value: '#e6ecdf', label: 'Sage' },
  { value: '#e2eaed', label: 'Mist' },
  { value: '#e7e8ea', label: 'Smoke' },
  { value: '#e9e6f0', label: 'Lavender' },
  { value: '#f2e4e1', label: 'Blush' },
  { value: '#ecdfd5', label: 'Clay' }
];

function relativeLuminance(red: number, green: number, blue: number): number {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Whether an ink colour needs a darkened page tint behind it. Light inks read
 * on a deep tint, dark inks read on the pastel itself.
 */
export function isLightInk(color: string): boolean {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return false;
  const hex = match[1].length === 3 ? match[1].replace(/./g, '$&$&') : match[1];
  const [red, green, blue] = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return relativeLuminance(red, green, blue) > 0.45;
}
