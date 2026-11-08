import { describe, it, expect } from 'vitest';
import { getStrokesBoundingBox, getPressureWidth } from './inkSmoothing';
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
});
