import type { ArrowAnchor, ArrowKind, ArrowSide, NoteArrow, TextBlockLayout } from '../types/note';
import { transformTextBlockPoint } from './inkSelection';
import { pointInTextLayer } from './pageObjects';
import type { Bounds, Point } from './inkSelection';

/** Extra page-space distance an arrow end pulls towards a nearby object edge. */
export const ARROW_SNAP_DISTANCE = 16;

/** One snap target on the page: a text box, table or picture. */
export interface ArrowTarget {
  id: string;
  /** Local rectangle when a page placement is supplied. */
  bounds: Bounds;
  placement?: TextBlockLayout;
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

function findTarget(targets: readonly ArrowTarget[], id?: string) {
  return id ? targets.find((target) => target.id === id) : undefined;
}

function toPage(target: ArrowTarget, point: Point): Point {
  return target.placement ? transformTextBlockPoint(point, target.placement) : point;
}

function toObject(target: ArrowTarget, point: Point): Point {
  return target.placement ? pointInTextLayer(point, target.placement) : point;
}

/** Older arrows recorded the snap point before they recorded the edge. */
export function lockArrowSides(arrow: NoteArrow, targets: readonly ArrowTarget[]): NoteArrow {
  const lock = (anchor: ArrowAnchor | undefined, point: Point) => {
    if (!anchor || anchor.side) return anchor;
    const target = findTarget(targets, anchor.objectId);
    return target ? { ...anchor, side: nearestEdge(target.bounds, toObject(target, point)).side } : anchor;
  };
  const startAnchor = lock(arrow.startAnchor, arrow.start);
  const endAnchor = lock(arrow.endAnchor, arrow.end);
  return startAnchor === arrow.startAnchor && endAnchor === arrow.endAnchor
    ? arrow : { ...arrow, startAnchor, endAnchor };
}

function arrowEndpoints(arrow: NoteArrow, targets: readonly ArrowTarget[]): { start: Point; end: Point } {
  const locked = lockArrowSides(arrow, targets);
  const startTarget = findTarget(targets, locked.startAnchor?.objectId);
  const endTarget = findTarget(targets, locked.endAnchor?.objectId);
  const startAim = endTarget ? toPage(endTarget, center(endTarget.bounds)) : arrow.end;
  const endAim = startTarget ? toPage(startTarget, center(startTarget.bounds)) : arrow.start;
  return {
    start: startTarget && locked.startAnchor?.side
      ? toPage(startTarget, pointOnEdge(startTarget.bounds, toObject(startTarget, startAim), locked.startAnchor.side))
      : arrow.start,
    end: endTarget && locked.endAnchor?.side
      ? toPage(endTarget, pointOnEdge(endTarget.bounds, toObject(endTarget, endAim), locked.endAnchor.side))
      : arrow.end,
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

const sides: ArrowSide[] = ['left', 'right', 'top', 'bottom'];

function pointOnEdge(bounds: Bounds, point: Point, side: ArrowSide): Point {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  return {
    x: side === 'left' ? bounds.x : side === 'right' ? right : clamp(point.x, bounds.x, right),
    y: side === 'top' ? bounds.y : side === 'bottom' ? bottom : clamp(point.y, bounds.y, bottom),
  };
}

function nearestEdge(bounds: Bounds, point: Point) {
  const candidates = sides.map((side) => {
    const edge = pointOnEdge(bounds, point, side);
    const distance = Math.hypot(edge.x - point.x, edge.y - point.y);
    // When two sides meet at a corner, prefer the side the pointer is farther outside.
    const normal = side === 'left' || side === 'right' ? Math.abs(edge.x - point.x) : Math.abs(edge.y - point.y);
    return { point: edge, side, distance, normal };
  });
  return candidates.reduce((best, candidate) =>
    candidate.distance < best.distance || (candidate.distance === best.distance && candidate.normal > best.normal)
      ? candidate : best);
}

export interface ArrowSnap {
  point: Point;
  anchor?: ArrowAnchor;
}

/** Snaps to the nearest object edge and records the side in object coordinates. */
export function snapArrowPoint(point: Point, targets: readonly ArrowTarget[], tolerance: number): ArrowSnap {
  let best: ArrowSnap = { point };
  let bestDistance = Infinity;
  for (const target of targets) {
    if (!target.bounds.width || !target.bounds.height) continue;
    const edge = nearestEdge(target.bounds, toObject(target, point));
    const distance = edge.distance * (target.placement?.scale ?? 1);
    if (distance > tolerance || distance >= bestDistance) continue;
    bestDistance = distance;
    best = { point: toPage(target, edge.point), anchor: { objectId: target.id, side: edge.side } };
  }
  return best;
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
