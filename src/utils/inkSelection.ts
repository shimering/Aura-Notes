import { SelectMode, Stroke, TextBlockLayout } from '../types/note';

/**
 * Geometry for the Select tool: which strokes a rectangle, circle or lasso
 * catches, plus the move / resize / rotate transform applied to a selection.
 *
 * Everything here is pure and works in page (CSS pixel) coordinates, so it can
 * be reasoned about and unit tested without a canvas.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The rubber-band geometry of one selection drag. */
export interface MarqueeGeometry {
  mode: SelectMode;
  start: Point;
  end: Point;
  /** Freehand path, only present for the lasso. */
  points?: Point[];
}

/**
 * A selection transform: scale and rotate about `origin`, then translate.
 * `rotation` is in radians.
 */
export interface InkTransform {
  originX: number;
  originY: number;
  translateX: number;
  translateY: number;
  scale: number;
  rotation: number;
}

export const IDENTITY_INK_TRANSFORM: InkTransform = {
  originX: 0,
  originY: 0,
  translateX: 0,
  translateY: 0,
  scale: 1,
  rotation: 0
};

export function isIdentityTransform(transform: InkTransform): boolean {
  return (
    Math.abs(transform.translateX) < 0.5 &&
    Math.abs(transform.translateY) < 0.5 &&
    Math.abs(transform.scale - 1) < 0.01 &&
    Math.abs(transform.rotation) < 0.005
  );
}

/**
 * Bounding box of the drawn objects, padded by half the stroke width so the
 * frame hugs the ink rather than its centerline.
 */
export function getStrokesBounds(strokes: Stroke[]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of strokes) {
    if (stroke.tool === 'eraser') continue;
    const pad = Math.max(2, stroke.width / 2);
    for (const point of stroke.points) {
      if (point.x - pad < minX) minX = point.x - pad;
      if (point.y - pad < minY) minY = point.y - pad;
      if (point.x + pad > maxX) maxX = point.x + pad;
      if (point.y + pad > maxY) maxY = point.y + pad;
    }
  }

  if (!Number.isFinite(minX)) return null;
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

export function transformPoint(point: Point, transform: InkTransform): Point {
  const dx = point.x - transform.originX;
  const dy = point.y - transform.originY;
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);
  const sx = dx * transform.scale;
  const sy = dy * transform.scale;
  return {
    x: transform.originX + sx * cos - sy * sin + transform.translateX,
    y: transform.originY + sx * sin + sy * cos + transform.translateY
  };
}

/** Axis-aligned box around the transformed corners (used for the dotted frame). */
export function transformBounds(bounds: Bounds, transform: InkTransform): Bounds {
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
  ].map((corner) => transformPoint(corner, transform));

  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, Math.max(...xs) - minX),
    height: Math.max(1, Math.max(...ys) - minY)
  };
}

/**
 * Applies a transform to the selected strokes only and bakes the result into
 * the point coordinates, so a transformed drawing stays a plain stroke list and
 * syncs like any other ink.
 */
export function applyInkTransform(
  strokes: Stroke[],
  selectedIds: Set<string>,
  transform: InkTransform
): Stroke[] {
  if (selectedIds.size === 0) return strokes;

  return strokes.map((stroke) => {
    if (!selectedIds.has(stroke.id)) return stroke;
    return {
      ...stroke,
      width: Math.max(0.5, stroke.width * transform.scale),
      points: stroke.points.map((point) => {
        const next = transformPoint(point, transform);
        return { ...point, x: next.x, y: next.y };
      })
    };
  });
}

// ---- Typed text block -----------------------------------------------------
//
// The note's typed text is one block. Its placement is stored as a similarity
// transform (translate, then rotate, then scale about the block's top-left),
// which composes cleanly with the same move / resize / rotate gestures used for
// ink. All of this works in page coordinates.

export const IDENTITY_TEXT_BLOCK_LAYOUT: TextBlockLayout = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0
};

export function isIdentityTextBlockLayout(layout: TextBlockLayout): boolean {
  return (
    Math.abs(layout.x) < 0.5 &&
    Math.abs(layout.y) < 0.5 &&
    Math.abs(layout.scale - 1) < 0.001 &&
    Math.abs(layout.rotation) < 0.001
  );
}

/** Maps a point in the text block's untransformed space to the page. */
export function transformTextBlockPoint(point: Point, layout: TextBlockLayout): Point {
  const cos = Math.cos(layout.rotation);
  const sin = Math.sin(layout.rotation);
  const x = point.x * layout.scale;
  const y = point.y * layout.scale;
  return {
    x: layout.x + x * cos - y * sin,
    y: layout.y + x * sin + y * cos
  };
}

/** Axis-aligned page box around the transformed text block. */
export function transformTextBlockBounds(local: Bounds, layout: TextBlockLayout): Bounds {
  const corners = [
    { x: local.x, y: local.y },
    { x: local.x + local.width, y: local.y },
    { x: local.x, y: local.y + local.height },
    { x: local.x + local.width, y: local.y + local.height }
  ].map((corner) => transformTextBlockPoint(corner, layout));

  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, Math.max(...xs) - minX),
    height: Math.max(1, Math.max(...ys) - minY)
  };
}

/**
 * Applies a live move / resize / rotate to the block's saved placement. The
 * text block uses `transform: translate(x, y) rotate(r) scale(s)` about its
 * top-left, so composing two such transforms stays in the same representation.
 */
export function composeTextBlockLayout(
  base: TextBlockLayout,
  live: InkTransform
): TextBlockLayout {
  const cos = Math.cos(live.rotation);
  const sin = Math.sin(live.rotation);
  const dx = base.x - live.originX;
  const dy = base.y - live.originY;
  const scaledX = dx * live.scale;
  const scaledY = dy * live.scale;

  return {
    x: live.originX + scaledX * cos - scaledY * sin + live.translateX,
    y: live.originY + scaledX * sin + scaledY * cos + live.translateY,
    scale: Math.max(0.05, base.scale * live.scale),
    rotation: base.rotation + live.rotation
  };
}

export function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b;
  if (!b) return a;
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function pointInBounds(point: Point, bounds: Bounds): boolean {
  return pointInRect(point, bounds);
}

function boundsCorners(bounds: Bounds): Point[] {
  return [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
  ];
}

function pointInEllipse(point: Point, cx: number, cy: number, rx: number, ry: number): boolean {
  const dx = (point.x - cx) / Math.max(1, rx);
  const dy = (point.y - cy) / Math.max(1, ry);
  return dx * dx + dy * dy <= 1;
}

/**
 * Whether a finished marquee should grab the text block. The block is only
 * taken when the marquee surrounds it completely, so dragging a rubber band
 * across part of the text does not unexpectedly move the text along with the
 * ink underneath it. A lasso must enclose every corner of the block.
 */
export function marqueeSelectsTextBlock(
  marquee: MarqueeGeometry,
  bounds: Bounds
): boolean {
  const corners = boundsCorners(bounds);

  if (marquee.mode === 'lasso') {
    const polygon = marquee.points && marquee.points.length >= 3 ? marquee.points : null;
    if (!polygon) return false;
    return corners.every((corner) => pointInPolygon(corner, polygon));
  }

  const minX = Math.min(marquee.start.x, marquee.end.x);
  const minY = Math.min(marquee.start.y, marquee.end.y);
  const maxX = Math.max(marquee.start.x, marquee.end.x);
  const maxY = Math.max(marquee.start.y, marquee.end.y);
  const rect: Bounds = {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };

  if (marquee.mode === 'ellipse') {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    return corners.every((corner) =>
      pointInEllipse(corner, cx, cy, rect.width / 2, rect.height / 2)
    );
  }

  return (
    bounds.x >= rect.x &&
    bounds.y >= rect.y &&
    bounds.x + bounds.width <= rect.x + rect.width &&
    bounds.y + bounds.height <= rect.y + rect.height
  );
}

function pointInRect(point: Point, rect: Bounds): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function onSegment(a: Point, b: Point, c: Point): boolean {
  return (
    Math.min(a.x, c.x) <= b.x &&
    b.x <= Math.max(a.x, c.x) &&
    Math.min(a.y, c.y) <= b.y &&
    b.y <= Math.max(a.y, c.y)
  );
}

/** True when the segments a→b and c→d cross each other. */
export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  if (o4 === 0 && onSegment(c, b, d)) return true;
  return false;
}

function segmentCrossesRect(a: Point, b: Point, rect: Bounds): boolean {
  const tl = { x: rect.x, y: rect.y };
  const tr = { x: rect.x + rect.width, y: rect.y };
  const br = { x: rect.x + rect.width, y: rect.y + rect.height };
  const bl = { x: rect.x, y: rect.y + rect.height };

  return (
    segmentsIntersect(a, b, tl, tr) ||
    segmentsIntersect(a, b, tr, br) ||
    segmentsIntersect(a, b, br, bl) ||
    segmentsIntersect(a, b, bl, tl)
  );
}

function segmentCrossesEllipse(
  a: Point,
  b: Point,
  cx: number,
  cy: number,
  rx: number,
  ry: number
): boolean {
  // Normalise to the unit circle and solve |a + t(b - a)|² = 1.
  const ax = (a.x - cx) / rx;
  const ay = (a.y - cy) / ry;
  const bx = (b.x - cx) / rx;
  const by = (b.y - cy) / ry;

  const dx = bx - ax;
  const dy = by - ay;
  const qa = dx * dx + dy * dy;
  if (qa === 0) return false;

  const qb = 2 * (ax * dx + ay * dy);
  const qc = ax * ax + ay * ay - 1;
  const discriminant = qb * qb - 4 * qa * qc;
  if (discriminant < 0) return false;

  const root = Math.sqrt(discriminant);
  const t1 = (-qb - root) / (2 * qa);
  const t2 = (-qb + root) / (2 * qa);
  const epsilon = 1e-6;
  return (
    (t1 >= -epsilon && t1 <= 1 + epsilon) || (t2 >= -epsilon && t2 <= 1 + epsilon)
  );
}

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function strokeHitsRect(stroke: Stroke, rect: Bounds): boolean {
  const points = stroke.points;
  for (const point of points) {
    if (pointInRect(point, rect)) return true;
  }
  for (let i = 1; i < points.length; i++) {
    if (segmentCrossesRect(points[i - 1], points[i], rect)) return true;
  }
  return false;
}

function strokeHitsEllipse(
  stroke: Stroke,
  cx: number,
  cy: number,
  rx: number,
  ry: number
): boolean {
  const inside = (point: Point) => {
    const dx = (point.x - cx) / rx;
    const dy = (point.y - cy) / ry;
    return dx * dx + dy * dy <= 1;
  };

  const points = stroke.points;
  for (const point of points) {
    if (inside(point)) return true;
  }
  for (let i = 1; i < points.length; i++) {
    if (segmentCrossesEllipse(points[i - 1], points[i], cx, cy, rx, ry)) return true;
  }
  return false;
}

function strokeHitsPolygon(stroke: Stroke, polygon: Point[]): boolean {
  const points = stroke.points;
  for (const point of points) {
    if (pointInPolygon(point, polygon)) return true;
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    for (let j = 0, k = polygon.length - 1; j < polygon.length; k = j++) {
      if (segmentsIntersect(a, b, polygon[k], polygon[j])) return true;
    }
  }
  return false;
}

/**
 * Ids of every stroke the marquee touches. A stroke counts when any part of it
 * falls inside the region, so half-covered drawings are selected whole.
 */
export function selectStrokeIds(strokes: Stroke[], marquee: MarqueeGeometry): string[] {
  const minX = Math.min(marquee.start.x, marquee.end.x);
  const minY = Math.min(marquee.start.y, marquee.end.y);
  const maxX = Math.max(marquee.start.x, marquee.end.x);
  const maxY = Math.max(marquee.start.y, marquee.end.y);
  const rect: Bounds = {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };

  const hit = (stroke: Stroke): boolean => {
    if (stroke.tool === 'eraser') return false;
    if (marquee.mode === 'lasso') {
      const polygon = marquee.points && marquee.points.length >= 3 ? marquee.points : null;
      if (!polygon) return strokeHitsRect(stroke, rect);
      return strokeHitsPolygon(stroke, polygon);
    }
    if (marquee.mode === 'ellipse') {
      return strokeHitsEllipse(
        stroke,
        minX + rect.width / 2,
        minY + rect.height / 2,
        Math.max(1, rect.width / 2),
        Math.max(1, rect.height / 2)
      );
    }
    return strokeHitsRect(stroke, rect);
  };

  return strokes.filter(hit).map((stroke) => stroke.id);
}

/** Squared distance from `point` to the segment a→b. */
function distanceToSegmentSquared(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  let t = 0;
  if (lengthSquared > 0) {
    t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
  }

  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return (point.x - x) ** 2 + (point.y - y) ** 2;
}

/**
 * Topmost stroke under a point, used for a tap-selection in Select mode. The
 * hit test follows each stroke's segments rather than its sampled points, so
 * quick strokes with sparse samples still pick up reliably.
 */
export function hitTestStroke(
  strokes: Stroke[],
  point: Point,
  tolerance: number = 10
): Stroke | null {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const stroke = strokes[i];
    if (stroke.tool === 'eraser') continue;

    const radius = Math.max(tolerance, stroke.width / 2 + tolerance);
    const r2 = radius * radius;
    const points = stroke.points;

    for (const p of points) {
      const dx = p.x - point.x;
      const dy = p.y - point.y;
      if (dx * dx + dy * dy <= r2) return stroke;
    }

    for (let j = 1; j < points.length; j++) {
      if (distanceToSegmentSquared(point, points[j - 1], points[j]) <= r2) {
        return stroke;
      }
    }
  }
  return null;
}

/**
 * Re-stacks the selection in front of everything, or behind everything (and
 * behind the note's text, on the back ink layer).
 */
export function reorderSelection(
  strokes: Stroke[],
  selectedIds: Set<string>,
  direction: 'front' | 'back'
): Stroke[] {
  if (selectedIds.size === 0) return strokes;
  const selected: Stroke[] = [];
  const rest: Stroke[] = [];

  for (const stroke of strokes) {
    if (selectedIds.has(stroke.id)) {
      selected.push({ ...stroke, layer: direction });
    } else {
      rest.push(stroke);
    }
  }

  return direction === 'front' ? [...rest, ...selected] : [...selected, ...rest];
}
