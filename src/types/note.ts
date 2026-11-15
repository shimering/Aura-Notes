export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
  time: number;
}

export type PenTool = 'pen' | 'fountain' | 'highlighter' | 'eraser' | 'text' | 'select';

/** Tools that paint ink; the others act on the page or on existing objects. */
export type WritingTool = 'pen' | 'fountain' | 'highlighter';

/** How the Select tool gathers objects: a rectangle, a circle, or a freehand lasso. */
export type SelectMode = 'rect' | 'ellipse' | 'lasso';

/**
 * Ink can sit above the note's text (default) or behind it. Strokes are drawn
 * on two layers so a drawing can pass behind typed text, like OneNote.
 */
export type StrokeLayer = 'front' | 'back';

/**
 * Object erasing removes whole vector strokes.
 * Pixel erasing splits strokes and only removes the part under the eraser.
 */
export type EraserMode = 'object' | 'pixel';

export type InkBackground = 'none' | 'ruled' | 'grid' | 'dotted';

export interface Stroke {
  id: string;
  points: StrokePoint[];
  color: string;
  width: number;
  tool: PenTool;
  opacity?: number;
  /** Which side of the note text this stroke is drawn on. Defaults to 'front'. */
  layer?: StrokeLayer;
}

/**
 * Page placement of the note's typed text block. The block starts at the
 * page's top-left and can be moved, scaled and rotated like a drawn object.
 * `rotation` is in radians.
 */
export interface TextBlockLayout {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface Note {
  id: string;
  title: string;
  content: string; // rich text HTML / block content
  inkStrokes: Stroke[]; // vector ink strokes for S Pen / Apple Pencil
  inkPreviewUrl?: string; // cached low-res thumbnail
  inkBackground?: InkBackground; // ruled / grid / dotted page style
  /** Move / resize / rotate applied to the typed text block. */
  textLayout?: TextBlockLayout;
  recognizedText?: string; // OCR'd handwriting, included in search
  tags: string[];
  color: string; // card accent color
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface RecognitionResult {
  text: string;
  confidence: number;
  bbox?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
}
