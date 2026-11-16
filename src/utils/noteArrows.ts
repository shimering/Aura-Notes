import type { ArrowKind, NoteArrow } from '../types/note';
import type { Bounds, Point } from './inkSelection';

/** Extra page-space distance an arrow end pulls towards a nearby object edge. */
export const ARROW_SNAP_DISTANCE = 16;

/** One snap target on the page: a text box, table or picture. */
export interface ArrowTarget {
  id: string;
  bounds: Bounds;
}

export interface ArrowGeometry {
  start: Point;
  end: Point;
  /** Bezier control point; the chord midpoint for a straight arrow. */
  control: Point;
  /** Where the shaft stops so the head's tip is not covered by the stroke. */
  lineEnd: Point;
  head: [Point, Point, Point];
}

function center(bounds: Bounds): Point {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

/**
 * Default bend for a curved arrow: a bow of about a fifth of its length,
 * perpendicular to the chord, so the curve is visible without dragging.
 */
export function arrowControlPoint(start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return { x: start.x, y: start.y };
  return {
    x: (start.x + end.x) / 2 - (dy / length) * length * 0.22,
    y: (start.y + end.y) / 2 + (dx / length) * length * 0.22,
  };
}

/**
 * Point where a ray from the object's centre towards `target` leaves its
 * bounds, so the arrow touches the object's surface instead of its middle.
 */
export function surfacePoint(bounds: Bounds, target: Point): Point {
  const { x: cx, y: cy } = center(bounds);
  const dx = target.x - cx;
  const dy = target.y - cy;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return { x: cx, y: cy };
  const halfWidth = Math.max(0.5, bounds.width / 2);
  const halfHeight = Math.max(0.5, bounds.height / 2);
  const tx = dx === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx);
  const ty = dy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

function findTarget(targets: readonly ArrowTarget[], id?: string) {
  return id ? targets.find((target) => target.id === id) : undefined;
}

/**
 * Resolves the arrow ends. A bound end sits on its object's surface and aims
 * at the other end, so arrows keep touching their elements after those move.
 */
function arrowEndpoints(
  arrow: NoteArrow,
  targets: readonly ArrowTarget[],
): { start: Point; end: Point } {
  const startRect = findTarget(targets, arrow.startAnchor?.objectId)?.bounds;
  const endRect = findTarget(targets, arrow.endAnchor?.objectId)?.bounds;
  const startAim = endRect ? center(endRect) : arrow.end;
  const endAim = startRect ? center(startRect) : arrow.start;
  return {
    start: startRect ? surfacePoint(startRect, startAim) : arrow.start,
    end: endRect ? surfacePoint(endRect, endAim) : arrow.end,
  };
}

export function arrowGeometry(arrow: NoteArrow, targets: readonly ArrowTarget[]): ArrowGeometry {
  const { start, end } = arrowEndpoints(arrow, targets);
  const control = arrow.kind === 'curved'
    ? arrow.bend ?? arrowControlPoint(start, end)
    : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

  const headLength = Math.max(9, arrow.width * 3.2);
  const tail = arrow.kind === 'curved' ? control : start;
  const dx = end.x - tail.x;
  const dy = end.y - tail.y;
  const direction = Math.hypot(dx, dy);
  const ux = direction > 0.001 ? dx / direction : 1;
  const uy = direction > 0.001 ? dy / direction : 0;
  const base = { x: end.x - ux * headLength, y: end.y - uy * headLength };
  const halfWidth = headLength * 0.4;
  return {
    start,
    end,
    control,
    lineEnd: { x: end.x - ux * headLength * 0.85, y: end.y - uy * headLength * 0.85 },
    head: [
      end,
      { x: base.x - uy * halfWidth, y: base.y + ux * halfWidth },
      { x: base.x + uy * halfWidth, y: base.y - ux * halfWidth },
    ],
  };
}

export function arrowPath(arrow: NoteArrow, geometry: ArrowGeometry): string {
  const { start, control, lineEnd } = geometry;
  return arrow.kind === 'curved'
    ? `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${lineEnd.x} ${lineEnd.y}`
    : `M ${start.x} ${start.y} L ${lineEnd.x} ${lineEnd.y}`;
}

export function arrowHeadPoints(geometry: ArrowGeometry) {
  return geometry.head.map((point) => `${point.x},${point.y}`).join(' ');
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Nearest point on the object's border, inside or outside it. */
function nearestOnBounds(bounds: Bounds, point: Point): Point {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  if (point.x < bounds.x || point.x > right || point.y < bounds.y || point.y > bottom) {
    return { x: clamp(point.x, bounds.x, right), y: clamp(point.y, bounds.y, bottom) };
  }
  const distances = [
    { value: point.x - bounds.x, edge: { x: bounds.x, y: point.y } },
    { value: right - point.x, edge: { x: right, y: point.y } },
    { value: point.y - bounds.y, edge: { x: point.x, y: bounds.y } },
    { value: bottom - point.y, edge: { x: point.x, y: bottom } },
  ];
  return distances.reduce((nearest, candidate) =>
    candidate.value < nearest.value ? candidate : nearest).edge;
}

/**
 * Snaps a page point onto the closest object edge within `tolerance`, and
 * reports the object so the arrow can follow it.
 */
export function snapArrowPoint(
  point: Point,
  targets: readonly ArrowTarget[],
  tolerance: number,
): { point: Point; objectId?: string } {
  let best: { point: Point; objectId: string; distance: number } | undefined;
  for (const target of targets) {
    if (!target.bounds.width || !target.bounds.height) continue;
    const nearest = nearestOnBounds(target.bounds, point);
    const distance = Math.hypot(nearest.x - point.x, nearest.y - point.y);
    if (distance > tolerance || (best && distance >= best.distance)) continue;
    best = { point: nearest, objectId: target.id, distance };
  }
  return best ? { point: best.point, objectId: best.objectId } : { point };
}

/** Moves an arrow freely, releasing it from the objects it was attached to. */
export function moveArrow(arrow: NoteArrow, delta: Point): NoteArrow {
  return {
    ...arrow,
    start: { x: arrow.start.x + delta.x, y: arrow.start.y + delta.y },
    end: { x: arrow.end.x + delta.x, y: arrow.end.y + delta.y },
    ...(arrow.bend ? { bend: { x: arrow.bend.x + delta.x, y: arrow.bend.y + delta.y } } : {}),
    startAnchor: undefined,
    endAnchor: undefined,
  };
}

/** Drops a curved arrow's stored bend, returning it to the default bow. */
export function withArrowKind(arrow: NoteArrow, kind: ArrowKind): NoteArrow {
  return { ...arrow, kind, ...(kind === 'straight' ? { bend: undefined } : {}) };
}
