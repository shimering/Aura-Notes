import { describe, expect, it } from 'vitest';
import {
  A4_LANDSCAPE,
  A4_PORTRAIT,
  clampPageZoom,
  getFitWidthZoom,
  getPageSize,
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

  it('clamps zoom to the supported range', () => {
    expect(clampPageZoom(0.01)).toBe(MIN_PAGE_ZOOM);
    expect(clampPageZoom(99)).toBe(MAX_PAGE_ZOOM);
    expect(clampPageZoom(1.25)).toBe(1.25);
    expect(clampPageZoom(Number.NaN)).toBe(1);
  });

  it('fits the sheet width inside a viewport', () => {
    expect(getFitWidthZoom(794, 794)).toBe(1);
    expect(getFitWidthZoom(397, 794)).toBe(0.5);
    // Gutters are removed from both sides before fitting.
    expect(getFitWidthZoom(794, 794, 24)).toBeCloseTo(746 / 794, 5);
    // A viewport wider than the sheet never zooms past 100% when fitting.
    expect(getFitWidthZoom(1400, 794)).toBe(1);
  });
});
