import { describe, expect, it } from 'vitest';
import type { NoteArrow } from '../types/note';
import {
  arrowControlPoint, arrowGeometry, arrowPath, moveArrow, snapArrowPoint,
  lockArrowSides, withArrowKind,
} from './noteArrows';

const arrow: NoteArrow = {
  id: 'arrow-1', kind: 'straight', color: '#1e293b', width: 3,
  start: { x: 0, y: 0 }, end: { x: 100, y: 0 },
};

const left = { id: 'a', bounds: { x: 0, y: 0, width: 40, height: 40 } };
const right = { id: 'b', bounds: { x: 140, y: 0, width: 40, height: 40 } };

describe('arrow geometry', () => {
  it('slides each endpoint along its attached edge toward the other object', () => {
    const attached: NoteArrow = {
      ...arrow, startAnchor: { objectId: 'a', side: 'right' }, endAnchor: { objectId: 'b', side: 'left' },
    };
    const { start, end } = arrowGeometry(attached, [left, right]);
    expect(start).toEqual({ x: 40, y: 20 });
    expect(end).toEqual({ x: 140, y: 20 });
  });

  it('keeps a free end where the user drew it', () => {
    const { start, end } = arrowGeometry({ ...arrow, startAnchor: { objectId: 'a', side: 'right' } }, [left, right]);
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
    expect(snapArrowPoint({ x: 52, y: 20 }, [left], 16)).toEqual({ point: { x: 40, y: 20 }, anchor: { objectId: 'a', side: 'right' } });
    expect(snapArrowPoint({ x: 90, y: 20 }, [left], 16)).toEqual({ point: { x: 90, y: 20 } });
  });

  it('snaps a point inside an object out to its closest side', () => {
    expect(snapArrowPoint({ x: 37, y: 20 }, [left], 16)).toEqual({ point: { x: 40, y: 20 }, anchor: { objectId: 'a', side: 'right' } });
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

  it('preserves a legacy snap side when the other end crosses behind it', () => {
    const attached = lockArrowSides({ ...arrow, start: { x: 40, y: 23 }, startAnchor: { objectId: 'a' } }, [left]);
    expect(attached.startAnchor?.side).toBe('right');
    expect(arrowGeometry({ ...attached, end: { x: -50, y: 27 } }, [left]).start).toEqual({ x: 40, y: 27 });
    expect(arrowGeometry({ ...attached, end: { x: -50, y: 80 } }, [left]).start).toEqual({ x: 40, y: 40 });
  });

  it('uses the same local edge after the object rotates and scales', () => {
    const rotated = { ...left, placement: { x: 100, y: 80, scale: 2, rotation: Math.PI / 2 } };
    const snap = snapArrowPoint({ x: 60, y: 165 }, [rotated], 16);
    expect(snap.anchor).toEqual({ objectId: 'a', side: 'right' });
    const { start } = arrowGeometry({
      ...arrow, start: snap.point, startAnchor: snap.anchor, end: { x: 52, y: 50 },
    }, [rotated]);
    expect(start.x).toBeCloseTo(52);
    expect(start.y).toBeCloseTo(160);
  });
});
