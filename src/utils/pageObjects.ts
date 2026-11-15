import type { TextBlockLayout } from '../types/note';
import {
  composeTextBlockLayout, transformTextBlockBounds, transformTextBlockPoint,
  type Bounds, type InkTransform, type Point,
} from './inkSelection';

export const pictureWraps = {
  inline: 'In line',
  left: 'Wrap right of image',
  right: 'Wrap left of image',
  free: 'Free position',
} as const;

export function pointInTextLayer(point: Point, layout: TextBlockLayout): Point {
  const x = (point.x - layout.x) / layout.scale;
  const y = (point.y - layout.y) / layout.scale;
  const cos = Math.cos(layout.rotation);
  const sin = Math.sin(layout.rotation);
  return { x: x * cos + y * sin, y: y * cos - x * sin };
}

export function offsetWithin(element: HTMLElement, ancestor: HTMLElement): Point {
  let x = 0;
  let y = 0;
  for (let node: HTMLElement | null = element; node && node !== ancestor; node = node.offsetParent as HTMLElement | null) {
    x += node.offsetLeft;
    y += node.offsetTop;
  }
  return { x, y };
}

export interface PagePicture {
  image: HTMLImageElement;
  editorOffset: Point;
  placement: TextBlockLayout;
  bounds: Bounds;
  width: number;
}

export function measurePicture(image: HTMLImageElement, editor: HTMLElement, layer: HTMLElement, layout: TextBlockLayout): PagePicture {
  const editorOffset = offsetWithin(editor, layer);
  const position = offsetWithin(image, layer);
  const width = image.offsetWidth;
  const placement = { ...position, scale: 1, rotation: (parseFloat(image.style.rotate) || 0) * Math.PI / 180 };
  const pagePlacement = {
    ...transformTextBlockPoint(position, layout),
    scale: layout.scale,
    rotation: layout.rotation + placement.rotation,
  };
  return {
    image, editorOffset, placement, width,
    bounds: transformTextBlockBounds({ x: 0, y: 0, width, height: image.offsetHeight }, pagePlacement),
  };
}

export function placePicture(image: HTMLImageElement, point: Point, width: number, rotation = 0) {
  image.dataset.pictureWrap = 'free';
  image.style.left = `${Math.round(point.x)}px`;
  image.style.top = `${Math.round(point.y)}px`;
  image.style.width = `${Math.max(1, Math.min(8192, Math.round(width)))}px`;
  image.style.rotate = `${Math.round((rotation * 180 / Math.PI % 360) * 1000) / 1000}deg`;
}

export function transformPicture(picture: PagePicture, layer: TextBlockLayout, transform: InkTransform, commit: boolean) {
  const { image, placement, editorOffset, width } = picture;
  const pagePlacement = {
    ...transformTextBlockPoint(placement, layer),
    scale: layer.scale,
    rotation: layer.rotation + placement.rotation,
  };
  const next = composeTextBlockLayout(pagePlacement, transform);
  const local = pointInTextLayer(next, layer);
  if (commit) {
    const editor = image.closest<HTMLElement>('[data-note-editor]');
    if (!editor) return;
    if (image.parentElement !== editor) editor.append(image);
    placePicture(image, { x: local.x - editorOffset.x, y: local.y - editorOffset.y },
      width * transform.scale, placement.rotation + transform.rotation);
  } else {
    image.style.translate = `${local.x - placement.x}px ${local.y - placement.y}px`;
    image.style.transform = `rotate(${transform.rotation}rad) scale(${transform.scale})`;
  }
}

export const boxSelector = '[data-note-positioned="true"]';

export function boxPlacement(element: HTMLElement, layer: HTMLElement): TextBlockLayout {
  return {
    ...offsetWithin(element, layer),
    scale: 1,
    rotation: (parseFloat(element.style.rotate) || 0) * Math.PI / 180,
  };
}

export function pageBoxPlacement(element: HTMLElement, layer: HTMLElement, layout: TextBlockLayout) {
  const placement = boxPlacement(element, layer);
  return { ...transformTextBlockPoint(placement, layout), scale: layout.scale, rotation: layout.rotation + placement.rotation };
}

export function measureBox(element: HTMLElement, layer: HTMLElement, layout: TextBlockLayout): Bounds {
  return transformTextBlockBounds(
    { x: 0, y: 0, width: element.offsetWidth, height: element.offsetHeight },
    pageBoxPlacement(element, layer, layout),
  );
}

export function transformBox(
  box: HTMLElement, placement: TextBlockLayout, editorOffset: Point, width: number,
  layer: TextBlockLayout, transform: InkTransform, commit: boolean,
) {
  const pagePlacement = {
    ...transformTextBlockPoint(placement, layer),
    scale: layer.scale,
    rotation: layer.rotation + placement.rotation,
  };
  const next = composeTextBlockLayout(pagePlacement, transform);
  const local = pointInTextLayer(next, layer);
  if (commit) {
    box.style.left = `${Math.round(local.x - editorOffset.x)}px`;
    box.style.top = `${Math.round(local.y - editorOffset.y)}px`;
    if (transform.scale !== 1) {
      box.style.width = `${Math.max(48, Math.min(8192, Math.round(width * transform.scale)))}px`;
    } else if (!box.style.width && !box.matches('[data-note-table="true"]')) {
      // Keep the measured width of legacy boxes that originally filled the sheet.
      box.style.width = `${width}px`;
    }
    box.style.rotate = `${Math.round((placement.rotation + transform.rotation) * 180 / Math.PI % 360 * 1000) / 1000}deg`;
  } else {
    box.style.translate = `${local.x - placement.x}px ${local.y - placement.y}px`;
    box.style.transform = `rotate(${transform.rotation}rad) scale(${transform.scale})`;
  }
}

/** Align matching edges or dock beside a nearby object. Distant rows and columns do not attract. */
export function snapObjectMove(bounds: Bounds, delta: Point, neighbors: Bounds[], tolerance: number): Point {
  const left = bounds.x + delta.x;
  const right = left + bounds.width;
  const top = bounds.y + delta.y;
  const bottom = top + bounds.height;
  let dx = 0;
  let dy = 0;
  let bestX = tolerance + Number.EPSILON;
  let bestY = tolerance + Number.EPSILON;
  for (const neighbor of neighbors) {
    const nr = neighbor.x + neighbor.width;
    const nb = neighbor.y + neighbor.height;
    if (top <= nb + tolerance && bottom >= neighbor.y - tolerance) {
      for (const offset of [neighbor.x - left, nr - right, neighbor.x - right, nr - left]) {
        if (Math.abs(offset) >= bestX) continue;
        bestX = Math.abs(offset);
        dx = offset;
      }
    }
    if (left <= nr + tolerance && right >= neighbor.x - tolerance) {
      for (const offset of [neighbor.y - top, nb - bottom, neighbor.y - bottom, nb - top]) {
        if (Math.abs(offset) >= bestY) continue;
        bestY = Math.abs(offset);
        dy = offset;
      }
    }
  }
  return { x: delta.x + dx, y: delta.y + dy };
}
