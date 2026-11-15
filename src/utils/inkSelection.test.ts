import { describe, expect, it } from 'vitest';
import { Stroke, TextBlockLayout } from '../types/note';
import {
  composeTextBlockLayout,
  hitTestStroke,
  IDENTITY_TEXT_BLOCK_LAYOUT,
  marqueeSelectsTextBlock,
  transformTextBlockBounds,
  unionBounds
} from './inkSelection';

function stroke(points: { x: number; y: number }[], width = 2): Stroke {
  return {
    id: 'stroke-1',
    points: points.map((point) => ({ ...point, pressure: 1, time: 0 })),
    color: '#000000',
    width,
    tool: 'pen'
  };
}

describe('hitTestStroke', () => {
  it('hits the middle of a long segment even when samples are sparse', () => {
    const line = stroke([
      { x: 0, y: 0 },
      { x: 200, y: 0 }
    ]);

    expect(hitTestStroke([line], { x: 100, y: 4 }, 10)?.id).toBe('stroke-1');
  });

  it('does not hit far away from the stroke', () => {
    const line = stroke([
      { x: 0, y: 0 },
      { x: 200, y: 0 }
    ]);

    expect(hitTestStroke([line], { x: 100, y: 40 }, 10)).toBeNull();
  });
});

describe('composeTextBlockLayout', () => {
  const base: TextBlockLayout = { x: 50, y: 60, scale: 1, rotation: 0 };

  it('moves the block without changing its scale or angle', () => {
    const next = composeTextBlockLayout(base, {
      originX: 0,
      originY: 0,
      translateX: 12,
      translateY: -8,
      scale: 1,
      rotation: 0
    });

    expect(next.x).toBeCloseTo(62);
    expect(next.y).toBeCloseTo(52);
    expect(next.scale).toBeCloseTo(1);
    expect(next.rotation).toBeCloseTo(0);
  });

  it('scales around the live origin', () => {
    const next = composeTextBlockLayout(base, {
      originX: 50,
      originY: 60,
      translateX: 0,
      translateY: 0,
      scale: 2,
      rotation: 0
    });

    expect(next).toEqual({ x: 50, y: 60, scale: 2, rotation: 0 });
  });

  it('rotates the block position around the origin', () => {
    const next = composeTextBlockLayout(
      { x: 10, y: 0, scale: 1, rotation: 0 },
      {
        originX: 0,
        originY: 0,
        translateX: 0,
        translateY: 0,
        scale: 1,
        rotation: Math.PI / 2
      }
    );

    expect(next.x).toBeCloseTo(0);
    expect(next.y).toBeCloseTo(10);
    expect(next.rotation).toBeCloseTo(Math.PI / 2);
  });

  it('leaves an identity transform alone', () => {
    expect(
      composeTextBlockLayout(IDENTITY_TEXT_BLOCK_LAYOUT, {
        originX: 0,
        originY: 0,
        translateX: 0,
        translateY: 0,
        scale: 1,
        rotation: 0
      })
    ).toEqual(IDENTITY_TEXT_BLOCK_LAYOUT);
  });
});

describe('transformTextBlockBounds', () => {
  const local = { x: 0, y: 0, width: 100, height: 50 };

  it('applies scale and translation', () => {
    const bounds = transformTextBlockBounds(local, {
      x: 10,
      y: 20,
      scale: 2,
      rotation: 0
    });

    expect(bounds.x).toBeCloseTo(10);
    expect(bounds.y).toBeCloseTo(20);
    expect(bounds.width).toBeCloseTo(200);
    expect(bounds.height).toBeCloseTo(100);
  });

  it('reports the axis-aligned box of a rotated block', () => {
    const bounds = transformTextBlockBounds(local, {
      x: 0,
      y: 0,
      scale: 1,
      rotation: Math.PI / 2
    });

    expect(bounds.x).toBeCloseTo(-50);
    expect(bounds.y).toBeCloseTo(0);
    expect(bounds.width).toBeCloseTo(50);
    expect(bounds.height).toBeCloseTo(100);
  });
});

describe('marqueeSelectsTextBlock', () => {
  const text = { x: 100, y: 100, width: 200, height: 80 };

  it('selects a text block fully enclosed by a rectangle', () => {
    expect(
      marqueeSelectsTextBlock(
        {
          mode: 'rect',
          start: { x: 50, y: 50 },
          end: { x: 350, y: 220 }
        },
        text
      )
    ).toBe(true);
  });

  it('ignores a rectangle that only clips the text block', () => {
    expect(
      marqueeSelectsTextBlock(
        {
          mode: 'rect',
          start: { x: 50, y: 50 },
          end: { x: 200, y: 220 }
        },
        text
      )
    ).toBe(false);
  });

  it('selects with a lasso that surrounds the block', () => {
    const points = [
      { x: 40, y: 40 },
      { x: 380, y: 40 },
      { x: 380, y: 260 },
      { x: 40, y: 260 },
      { x: 40, y: 40 }
    ];

    expect(
      marqueeSelectsTextBlock(
        { mode: 'lasso', start: points[0], end: points[points.length - 1], points },
        text
      )
    ).toBe(true);
  });

  it('ignores an ellipse that does not contain the whole block', () => {
    expect(
      marqueeSelectsTextBlock(
        {
          mode: 'ellipse',
          start: { x: 0, y: 0 },
          end: { x: 250, y: 180 }
        },
        text
      )
    ).toBe(false);
  });
});

describe('unionBounds', () => {
  it('keeps the only box when one side is missing', () => {
    const box = { x: 1, y: 2, width: 3, height: 4 };
    expect(unionBounds(null, box)).toEqual(box);
    expect(unionBounds(box, null)).toEqual(box);
  });

  it('wraps both boxes', () => {
    expect(
      unionBounds(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: 5, width: 10, height: 10 }
      )
    ).toEqual({ x: 0, y: 0, width: 30, height: 15 });
  });
});
