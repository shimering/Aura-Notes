import { PageLayout } from '../types/note';

/**
 * The note page is a real A4 sheet: 210mm x 297mm at 96 CSS dpi. Keeping the
 * page a fixed size (instead of stretching to the window) means ink and text
 * keep their page placement when the window resizes or the sheet is rotated.
 */
export interface PageSize {
  width: number;
  height: number;
}

export const A4_PORTRAIT: PageSize = { width: 794, height: 1123 };
export const A4_LANDSCAPE: PageSize = { width: 1123, height: 794 };

/** Zoom limits for the page viewport (pinch, trackpad and buttons). */
export const MIN_PAGE_ZOOM = 0.25;
export const MAX_PAGE_ZOOM = 4;
export const PAGE_ZOOM_STEP = 0.15;

export function getPageSize(layout: PageLayout = 'portrait'): PageSize {
  return layout === 'landscape' ? A4_LANDSCAPE : A4_PORTRAIT;
}

export function clampPageZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_PAGE_ZOOM, Math.max(MIN_PAGE_ZOOM, zoom));
}

/**
 * Zoom that makes the whole sheet width visible inside a viewport. Used for the
 * opening view on phones and the "fit" button.
 */
export function getFitWidthZoom(
  viewportWidth: number,
  pageWidth: number,
  gutter = 0
): number {
  const available = Math.max(1, viewportWidth - gutter * 2);
  // Fitting never enlarges the sheet past its actual size.
  return clampPageZoom(Math.min(1, available / Math.max(1, pageWidth)));
}
