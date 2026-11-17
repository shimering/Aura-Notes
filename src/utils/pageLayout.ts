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

/** Phone-sized reference area in page pixels, shared by every device. */
export const CANVAS_SCREEN_SIZE: PageSize = { width: 390, height: 844 };
/** Blank space between the canvas origin and the text column. */
export const CANVAS_TEXT_INSET = 96;
/** Hard cap on one ink bitmap side so a large canvas cannot exhaust memory. */
export const CANVAS_MAX_BITMAP_SIZE = 3072;

export function getCanvasSize(right = 0, bottom = 0): PageSize {
  const { width, height } = CANVAS_SCREEN_SIZE;
  return {
    width: Math.ceil(Math.max(width, right) + width / 2),
    height: Math.ceil(Math.max(height, bottom) + height / 2),
  };
}

/** Zoom limits for the page viewport (pinch, trackpad and buttons). */
export const MIN_PAGE_ZOOM = 0.25;
export const MAX_PAGE_ZOOM = 4;
/** The endless canvas allows closer inspection than a fixed A4 sheet. */
export const CANVAS_MIN_ZOOM = 0.25;
export const CANVAS_MAX_ZOOM = 6;
export const PAGE_ZOOM_STEP = 0.15;

export function isCanvasLayout(layout: PageLayout = 'portrait'): boolean {
  return layout === 'canvas';
}

export function getPageSize(layout: PageLayout = 'portrait'): PageSize {
  if (layout === 'canvas') return getCanvasSize();
  return layout === 'landscape' ? A4_LANDSCAPE : A4_PORTRAIT;
}

export function getMinPageZoom(layout: PageLayout = 'portrait'): number {
  return isCanvasLayout(layout) ? CANVAS_MIN_ZOOM : MIN_PAGE_ZOOM;
}

export function getMaxPageZoom(layout: PageLayout = 'portrait'): number {
  return isCanvasLayout(layout) ? CANVAS_MAX_ZOOM : MAX_PAGE_ZOOM;
}

export function clampPageZoom(zoom: number, layout: PageLayout = 'portrait'): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(getMaxPageZoom(layout), Math.max(getMinPageZoom(layout), zoom));
}

/**
 * Zoom that makes the whole sheet width visible inside a viewport. Used for the
 * opening view on phones and the "fit" button.
 */
export function getFitWidthZoom(
  viewportWidth: number,
  pageWidth: number,
  gutter = 0,
  layout: PageLayout = 'portrait'
): number {
  const available = Math.max(1, viewportWidth - gutter * 2);
  // Fitting never enlarges the sheet past its actual size.
  return clampPageZoom(Math.min(1, available / Math.max(1, pageWidth)), layout);
}
