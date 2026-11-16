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
