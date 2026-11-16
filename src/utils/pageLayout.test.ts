import { describe, expect, it } from 'vitest';
import {
  A4_LANDSCAPE,
  A4_PORTRAIT,
  CANVAS_BASE_SIZE,
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  clampPageZoom,
  getFitWidthZoom,
  getMaxPageZoom,
  getMinPageZoom,
  getPageSize,
  isCanvasLayout,
  MAX_PAGE_ZOOM,
  MIN_PAGE_ZOOM
} from './pageLayout';

describe('page layouts', () => {
  it('uses A4 dimensions with the long edge first in landscape', () => {
    expect(getPageSize('portrait')).toEqual(A4_PORTRAIT);
    expect(getPageSize('landscape')).toEqual(A4_LANDSCAPE);
    expect(getPageSize()).toEqual(A4_PORTRAIT);
    expect(A4_LANDSCAPE.width).toBe(A4_PORTRAIT.height);
    expect(A4_LANDSCAPE.height).toBe(A4_PORTRAIT.width);
  });

  it('opens the endless canvas on a workspace larger than an A4 sheet', () => {
    expect(getPageSize('canvas')).toEqual(CANVAS_BASE_SIZE);
    expect(CANVAS_BASE_SIZE.width).toBeGreaterThan(A4_LANDSCAPE.width);
    expect(CANVAS_BASE_SIZE.height).toBeGreaterThan(A4_LANDSCAPE.height);
    expect(isCanvasLayout('canvas')).toBe(true);
    expect(isCanvasLayout('portrait')).toBe(false);
  });

  it('clamps zoom to the supported range', () => {
    expect(clampPageZoom(0.01)).toBe(MIN_PAGE_ZOOM);
    expect(clampPageZoom(99)).toBe(MAX_PAGE_ZOOM);
    expect(clampPageZoom(1.25)).toBe(1.25);
    expect(clampPageZoom(Number.NaN)).toBe(1);
  });

  it('allows a wider zoom range on the endless canvas', () => {
    expect([getMinPageZoom('canvas'), getMaxPageZoom('canvas')]).toEqual([CANVAS_MIN_ZOOM, CANVAS_MAX_ZOOM]);
    expect(CANVAS_MAX_ZOOM).toBeGreaterThan(MAX_PAGE_ZOOM);
    expect(clampPageZoom(0.01, 'canvas')).toBe(CANVAS_MIN_ZOOM);
    expect(clampPageZoom(99, 'canvas')).toBe(CANVAS_MAX_ZOOM);
    expect(clampPageZoom(6, 'canvas')).toBe(6);
  });

  it('fits the sheet width inside a viewport', () => {
    expect(getFitWidthZoom(794, 794)).toBe(1);
    expect(getFitWidthZoom(397, 794)).toBe(0.5);
    // Gutters are removed from both sides before fitting.
    expect(getFitWidthZoom(794, 794, 24)).toBeCloseTo(746 / 794, 5);
    // A viewport wider than the sheet never zooms past 100% when fitting.
    expect(getFitWidthZoom(1400, 794)).toBe(1);
    // Canvas fitting still respects the canvas minimum zoom.
    expect(getFitWidthZoom(100, CANVAS_BASE_SIZE.width, 0, 'canvas')).toBe(CANVAS_MIN_ZOOM);
  });
});
