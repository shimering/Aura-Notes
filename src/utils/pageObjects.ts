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

export type PictureWrap = keyof typeof pictureWraps;

export function getPictureWrap(image: HTMLImageElement): PictureWrap {
  const value = image.dataset.pictureWrap;
  return value && Object.hasOwn(pictureWraps, value) ? value as PictureWrap : 'inline';
}

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
    editor.append(image);
    placePicture(image, { x: local.x - editorOffset.x, y: local.y - editorOffset.y },
      width * transform.scale, placement.rotation + transform.rotation);
  } else {
    image.style.translate = `${local.x - placement.x}px ${local.y - placement.y}px`;
    image.style.transform = `rotate(${transform.rotation}rad) scale(${transform.scale})`;
  }
}
