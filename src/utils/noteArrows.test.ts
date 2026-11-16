import { describe, expect, it } from 'vitest';
import type { NoteArrow } from '../types/note';
import {
  arrowControlPoint, arrowGeometry, arrowPath, moveArrow, snapArrowPoint,
  surfacePoint, withArrowKind,
} from './noteArrows';

const arrow: NoteArrow = {
  id: 'arrow-1', kind: 'straight', color: '#1e293b', width: 3,
  start: { x: 0, y: 0 }, end: { x: 100, y: 0 },
};

const left = { id: 'a', bounds: { x: 0, y: 0, width: 40, height: 40 } };
const right = { id: 'b', bounds: { x: 140, y: 0, width: 40, height: 40 } };

describe('arrow geometry', () => {
  it('puts an anchored end on the object surface, facing the other object', () => {
    const attached: NoteArrow = { ...arrow, startAnchor: { objectId: 'a' }, endAnchor: { objectId: 'b' } };
    const { start, end } = arrowGeometry(attached, [left, right]);
    expect(start).toEqual({ x: 40, y: 20 });
    expect(end).toEqual({ x: 140, y: 20 });
  });

  it('keeps a free end where the user drew it', () => {
    const { start, end } = arrowGeometry({ ...arrow, startAnchor: { objectId: 'a' } }, [left, right]);
    expect(start.x).toBe(40);
    expect(end).toEqual({ x: 100, y: 0 });
  });

  it('curves through its bend control point', () => {
    const curved: NoteArrow = { ...arrow, kind: 'curved', bend: { x: 50, y: -60 } };
    const geometry = arrowGeometry(curved, []);
    expect(geometry.control).toEqual({ x: 50, y: -60 });
    expect(arrowPath(curved, geometry)).toContain('Q 50 -60');
  });

  it('computes the default bow from the chord', () => {
    const control = arrowControlPoint({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(Math.round(control.x)).toBe(50);
    expect(Math.round(Math.abs(control.y))).toBe(22);
  });

  it('snaps a nearby point onto the nearest object edge', () => {
    expect(snapArrowPoint({ x: 52, y: 20 }, [left], 16)).toEqual({ point: { x: 40, y: 20 }, objectId: 'a' });
    expect(snapArrowPoint({ x: 90, y: 20 }, [left], 16)).toEqual({ point: { x: 90, y: 20 } });
  });

  it('snaps a point inside an object out to its closest side', () => {
    expect(snapArrowPoint({ x: 37, y: 20 }, [left], 16)).toEqual({ point: { x: 40, y: 20 }, objectId: 'a' });
  });

  it('moves and detaches an arrow, and drops the bend when made straight', () => {
    const attached: NoteArrow = {
      ...arrow, startAnchor: { objectId: 'a' }, endAnchor: { objectId: 'b' }, bend: { x: 50, y: -20 }, kind: 'curved',
    };
    const moved = moveArrow(attached, { x: 10, y: 5 });
    expect(moved.start).toEqual({ x: 10, y: 5 });
    expect(moved.end).toEqual({ x: 110, y: 5 });
    expect(moved.bend).toEqual({ x: 60, y: -15 });
    expect(moved.startAnchor).toBeUndefined();
    expect(moved.endAnchor).toBeUndefined();

    const straight = withArrowKind({ ...arrow, kind: 'curved', bend: { x: 50, y: -20 } }, 'straight');
    expect(straight.kind).toBe('straight');
    expect(straight.bend).toBeUndefined();
  });

  it('resolves a surface point along the ray from the object centre', () => {
    expect(surfacePoint({ x: 0, y: 0, width: 100, height: 100 }, { x: 500, y: 50 })).toEqual({ x: 100, y: 50 });
  });
});
