import { Stroke, StrokePoint } from '../types/note';

/**
 * Calculates dynamic stroke width from pressure and tool settings.
 * S Pen and Apple Pencil supply e.pressure in range (0.0, 1.0].
 * If pointer device does not support pressure (e.g. standard mouse or basic stylus),
 * fallback smoothly to baseline.
 */
export function getPressureWidth(baseWidth: number, pressure: number, tool: Stroke['tool']): number {
  if (tool === 'highlighter') {
    return baseWidth * 2.8;
  }
  if (tool === 'eraser') {
    return baseWidth * 2.5;
  }
  
  const normalizedPressure = pressure > 0 ? pressure : 0.5;
  
  if (tool === 'fountain') {
    // Highly responsive calligraphic taper
    return baseWidth * (0.2 + 1.6 * Math.pow(normalizedPressure, 1.3));
  }

  // Smooth ballpoint pen
  return baseWidth * (0.5 + 0.9 * normalizedPressure);
}

/**
 * Renders a single stroke onto a Canvas 2D context using quadratic Bézier curves
 * between midpoints, completely covering endpoints from points[0] to points[last].
 */
export function renderStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  scale: number = 1
) {
  const points = stroke.points;
  if (!points || points.length === 0) return;

  ctx.save();

  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = stroke.width * 2 * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  } else if (stroke.tool === 'highlighter') {
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width * 2.8 * scale;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = stroke.opacity ?? 1.0;
    ctx.strokeStyle = stroke.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  if (points.length === 1) {
    const p = points[0];
    const r = (getPressureWidth(stroke.width, p.pressure, stroke.tool) * scale) / 2;
    ctx.beginPath();
    ctx.arc(p.x * scale, p.y * scale, Math.max(1, r), 0, Math.PI * 2);
    ctx.fillStyle = stroke.tool === 'eraser' ? 'rgba(0,0,0,1)' : stroke.color;
    ctx.fill();
    ctx.restore();
    return;
  }

  if (points.length === 2) {
    const p0 = points[0];
    const p1 = points[1];
    ctx.lineWidth = getPressureWidth(stroke.width, (p0.pressure + p1.pressure) / 2, stroke.tool) * scale;
    ctx.beginPath();
    ctx.moveTo(p0.x * scale, p0.y * scale);
    ctx.lineTo(p1.x * scale, p1.y * scale);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Multi-point stroke with dynamic Bézier interpolation
  // 1. Initial segment from points[0] to mid(points[0], points[1])
  const firstP = points[0];
  const secondP = points[1];
  const firstMidX = (firstP.x + secondP.x) / 2;
  const firstMidY = (firstP.y + secondP.y) / 2;

  ctx.lineWidth = getPressureWidth(stroke.width, firstP.pressure, stroke.tool) * scale;
  ctx.beginPath();
  ctx.moveTo(firstP.x * scale, firstP.y * scale);
  ctx.lineTo(firstMidX * scale, firstMidY * scale);
  ctx.stroke();

  // 2. Interior curves from mid1 to mid2
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];

    const mid1X = (p0.x + p1.x) / 2;
    const mid1Y = (p0.y + p1.y) / 2;
    const mid2X = (p1.x + p2.x) / 2;
    const mid2Y = (p1.y + p2.y) / 2;

    const segmentWidth = getPressureWidth(stroke.width, p1.pressure, stroke.tool) * scale;
    ctx.lineWidth = Math.max(1, segmentWidth);

    ctx.beginPath();
    ctx.moveTo(mid1X * scale, mid1Y * scale);
    ctx.quadraticCurveTo(p1.x * scale, p1.y * scale, mid2X * scale, mid2Y * scale);
    ctx.stroke();
  }

  // 3. Final segment from last midpoint to points[last]
  const lastP = points[points.length - 1];
  const prevP = points[points.length - 2];
  const lastMidX = (prevP.x + lastP.x) / 2;
  const lastMidY = (prevP.y + lastP.y) / 2;

  ctx.lineWidth = getPressureWidth(stroke.width, lastP.pressure, stroke.tool) * scale;
  ctx.beginPath();
  ctx.moveTo(lastMidX * scale, lastMidY * scale);
  ctx.lineTo(lastP.x * scale, lastP.y * scale);
  ctx.stroke();

  ctx.restore();
}

/**
 * Calculates bounding box around an array of strokes
 */
export function getStrokesBoundingBox(strokes: Stroke[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} | null {
  if (strokes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of strokes) {
    if (stroke.tool === 'eraser') continue;
    for (const p of stroke.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  if (minX === Infinity) return null;

  // Add padding
  const padding = 16;
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX += padding;
  maxY += padding;

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

/**
 * Checks if a point (px, py) is within radius of any point of a stroke.
 */
export function isPointNearStroke(stroke: Stroke, px: number, py: number, radius: number = 24): boolean {
  const r2 = radius * radius;
  for (const pt of stroke.points) {
    const dx = pt.x - px;
    const dy = pt.y - py;
    if (dx * dx + dy * dy <= r2) {
      return true;
    }
  }
  return false;
}

/**
 * Deletes any strokes that come within radius of the eraser point.
 * Provides instant, clean vector stroke erasing for S Pen and stylus.
 */
export function eraseStrokesNearPoint(
  strokes: Stroke[],
  px: number,
  py: number,
  radius: number = 24
): { remaining: Stroke[]; hasErased: boolean } {
  let hasErased = false;
  const remaining = strokes.filter(s => {
    if (s.tool === 'eraser') return false;
    const hit = isPointNearStroke(s, px, py, radius);
    if (hit) hasErased = true;
    return !hit;
  });
  return { remaining, hasErased };
}

/**
 * Interpolates a StrokePoint between two samples. Used to cut a stroke exactly
 * at the eraser circle boundary so partial erasing stays smooth.
 */
function interpolatePoint(a: StrokePoint, b: StrokePoint, t: number): StrokePoint {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    pressure: a.pressure + (b.pressure - a.pressure) * t,
    time: a.time + (b.time - a.time) * t
  };
}

/**
 * Returns the parameters (0..1) where a segment enters and exits a circle.
 * Empty when the segment does not cross the circle.
 */
function segmentCircleIntersections(
  a: StrokePoint,
  b: StrokePoint,
  cx: number,
  cy: number,
  radius: number
): number[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - cx;
  const fy = a.y - cy;

  const a2 = dx * dx + dy * dy;
  if (a2 === 0) return [];

  const b2 = 2 * (fx * dx + fy * dy);
  const c2 = fx * fx + fy * fy - radius * radius;
  const discriminant = b2 * b2 - 4 * a2 * c2;
  if (discriminant < 0) return [];

  const sqrtD = Math.sqrt(discriminant);
  const epsilon = 1e-6;
  const t1 = (-b2 - sqrtD) / (2 * a2);
  const t2 = (-b2 + sqrtD) / (2 * a2);

  const result: number[] = [];
  if (t1 >= -epsilon && t1 <= 1 + epsilon) result.push(Math.min(1, Math.max(0, t1)));
  if (t2 >= -epsilon && t2 <= 1 + epsilon) {
    const clamped = Math.min(1, Math.max(0, t2));
    if (!result.length || Math.abs(clamped - result[result.length - 1]) > epsilon) {
      result.push(clamped);
    }
  }
  return result;
}

/**
 * Splits one stroke into the pieces that remain after removing the parts inside
 * the eraser circle. Returns null when the stroke is untouched.
 */
function splitStrokeAroundCircle(
  stroke: Stroke,
  cx: number,
  cy: number,
  radius: number
): StrokePoint[][] | null {
  const points = stroke.points;
  if (!points || points.length === 0) return null;

  const radiusSq = radius * radius;
  const inside = (p: StrokePoint) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return dx * dx + dy * dy <= radiusSq;
  };

  const firstInside = inside(points[0]);
  let changed = firstInside;
  let current: StrokePoint[] = firstInside ? [] : [points[0]];
  const pieces: StrokePoint[][] = [];

  const endRun = () => {
    if (current.length > 0) {
      pieces.push(current);
      current = [];
    }
  };

  const addPoint = (p: StrokePoint) => {
    const last = current[current.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) {
      current.push(p);
    }
  };

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const aInside = inside(a);
    const bInside = inside(b);

    if (!aInside && !bInside) {
      const ts = segmentCircleIntersections(a, b, cx, cy, radius);
      if (ts.length >= 2) {
        // Segment passes straight through the eraser: keep both outside ends.
        addPoint(interpolatePoint(a, b, ts[0]));
        endRun();
        current = [interpolatePoint(a, b, ts[1])];
        addPoint(b);
        changed = true;
      } else {
        addPoint(b);
      }
    } else if (aInside && bInside) {
      endRun();
    } else if (!aInside && bInside) {
      const ts = segmentCircleIntersections(a, b, cx, cy, radius);
      if (ts.length > 0) addPoint(interpolatePoint(a, b, ts[0]));
      endRun();
      changed = true;
    } else {
      const ts = segmentCircleIntersections(a, b, cx, cy, radius);
      const exitT = ts.length > 0 ? ts[ts.length - 1] : 0;
      current = [interpolatePoint(a, b, exitT)];
      addPoint(b);
      changed = true;
    }
  }

  endRun();
  return changed ? pieces : null;
}

/**
 * Pixel-style erasing: removes only the portion of each stroke inside the
 * eraser circle and splits the remaining geometry into separate strokes.
 * Unlike object erasing, nearby strokes are not deleted in full.
 */
export function eraseStrokesPartial(
  strokes: Stroke[],
  px: number,
  py: number,
  radius: number = 24
): { remaining: Stroke[]; hasErased: boolean } {
  if (strokes.length === 0) {
    return { remaining: strokes, hasErased: false };
  }

  const safeRadius = Math.max(1, radius);
  const remaining: Stroke[] = [];
  let hasErased = false;

  for (const stroke of strokes) {
    if (stroke.tool === 'eraser') continue;

    // Expand the clip radius by half the rendered stroke width so pixel erasing
    // visually removes the ink, not just the centerline.
    const strokePadding = stroke.tool === 'highlighter' ? stroke.width * 1.4 : stroke.width / 2;
    const pieces = splitStrokeAroundCircle(stroke, px, py, safeRadius + strokePadding);
    if (!pieces) {
      remaining.push(stroke);
      continue;
    }

    hasErased = true;
    const baseId = stroke.id.split('~e')[0];
    pieces.forEach((piece, index) => {
      remaining.push({
        ...stroke,
        id: `${baseId}~e${index}`,
        points: piece
      });
    });
  }

  return { remaining, hasErased };
}
