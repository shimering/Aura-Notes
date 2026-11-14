import { describe, it, expect } from 'vitest';
import { getStrokesBoundingBox, getPressureWidth, eraseStrokesNearPoint, eraseStrokesPartial, isPointNearStroke } from './inkSmoothing';
import { Stroke } from '../types/note';

describe('Ink Smoothing & Bounding Box', () => {
  it('correctly calculates dynamic pressure width for fountain and ballpoint', () => {
    const lightPressure = getPressureWidth(4, 0.2, 'fountain');
    const heavyPressure = getPressureWidth(4, 0.9, 'fountain');
    expect(heavyPressure).toBeGreaterThan(lightPressure);

    const ballpointLight = getPressureWidth(4, 0.2, 'pen');
    const ballpointHeavy = getPressureWidth(4, 0.9, 'pen');
    expect(ballpointHeavy).toBeGreaterThan(ballpointLight);
  });

  it('includes initial and final stroke coordinates in bounding box', () => {
    const stroke: Stroke = {
      id: 'test-1',
      points: [
        { x: 10, y: 15, pressure: 0.5, time: 100 },
        { x: 50, y: 80, pressure: 0.7, time: 120 },
        { x: 120, y: 140, pressure: 0.6, time: 140 }
      ],
      color: '#000000',
      width: 4,
      tool: 'pen'
    };

    const bbox = getStrokesBoundingBox([stroke]);
    expect(bbox).not.toBeNull();
    // Padding is 16
    expect(bbox!.minX).toBeLessThanOrEqual(10);
    expect(bbox!.minY).toBeLessThanOrEqual(15);
    expect(bbox!.maxX).toBeGreaterThanOrEqual(120);
    expect(bbox!.maxY).toBeGreaterThanOrEqual(140);
  });

  it('erases strokes near an eraser point', () => {
    const stroke1: Stroke = {
      id: 'stroke-1',
      points: [
        { x: 100, y: 100, pressure: 0.5, time: 100 },
        { x: 105, y: 105, pressure: 0.5, time: 110 }
      ],
      color: '#000000',
      width: 4,
      tool: 'fountain'
    };
    const stroke2: Stroke = {
      id: 'stroke-2',
      points: [
        { x: 300, y: 300, pressure: 0.5, time: 100 },
        { x: 305, y: 305, pressure: 0.5, time: 110 }
      ],
      color: '#000000',
      width: 4,
      tool: 'fountain'
    };

    // Erasing near stroke1 (at 102, 102 with radius 20)
    const { remaining, hasErased } = eraseStrokesNearPoint([stroke1, stroke2], 102, 102, 20);
    expect(hasErased).toBe(true);
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe('stroke-2');
  });
});

describe('Pixel (partial) erasing', () => {
  const makeStroke = (id: string, points: { x: number; y: number }[]): Stroke => ({
    id,
    points: points.map((p, i) => ({ ...p, pressure: 0.5, time: 100 + i * 10 })),
    color: '#000000',
    width: 4,
    tool: 'pen'
  });

  it('splits a stroke in two when erasing through its middle', () => {
    const stroke = makeStroke('line', [{ x: 0, y: 50 }, { x: 100, y: 50 }]);

    const { remaining, hasErased } = eraseStrokesPartial([stroke], 50, 50, 10);

    expect(hasErased).toBe(true);
    expect(remaining).toHaveLength(2);
    // First piece ends at the left edge of the eraser circle (radius 10 + 2px stroke padding).
    expect(remaining[0].points[remaining[0].points.length - 1].x).toBeCloseTo(38, 5);
    expect(remaining[0].points[0].x).toBe(0);
    // Second piece starts at the right edge of the eraser circle.
    expect(remaining[1].points[0].x).toBeCloseTo(62, 5);
    expect(remaining[1].points[remaining[1].points.length - 1].x).toBe(100);
    expect(remaining[0].id).not.toBe(remaining[1].id);
  });

  it('removes the entire stroke when it is fully covered', () => {
    const stroke = makeStroke('covered', [{ x: 45, y: 50 }, { x: 55, y: 50 }]);

    const { remaining, hasErased } = eraseStrokesPartial([stroke], 50, 50, 30);

    expect(hasErased).toBe(true);
    expect(remaining).toHaveLength(0);
  });

  it('leaves strokes outside the eraser circle untouched', () => {
    const stroke = makeStroke('far', [{ x: 300, y: 300 }, { x: 320, y: 320 }]);

    const { remaining, hasErased } = eraseStrokesPartial([stroke], 50, 50, 24);

    expect(hasErased).toBe(false);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toBe(stroke);
  });

  it('only clips the touched end of a stroke', () => {
    const stroke = makeStroke('end', [{ x: 0, y: 0 }, { x: 100, y: 0 }]);

    const { remaining, hasErased } = eraseStrokesPartial([stroke], 100, 0, 20);

    expect(hasErased).toBe(true);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].points[0].x).toBe(0);
    expect(remaining[0].points[remaining[0].points.length - 1].x).toBeCloseTo(78, 5);
  });

  it('keeps nearby strokes whole instead of deleting them like object mode', () => {
    const left = makeStroke('left', [{ x: 0, y: 50 }, { x: 40, y: 50 }]);
    const right = makeStroke('right', [{ x: 60, y: 50 }, { x: 100, y: 50 }]);

    const partial = eraseStrokesPartial([left, right], 50, 50, 10);
    expect(partial.remaining).toHaveLength(2);
    expect(partial.remaining.every(s => s.points.length > 0)).toBe(true);

    // Object mode deletes both strokes because their end points touch the circle.
    const object = eraseStrokesNearPoint([left, right], 50, 50, 10);
    expect(object.remaining).toHaveLength(0);
  });
});
