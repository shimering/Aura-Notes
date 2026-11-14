export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
  time: number;
}

export type PenTool = 'pen' | 'fountain' | 'highlighter' | 'eraser' | 'lasso';

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
}

export interface Note {
  id: string;
  title: string;
  content: string; // rich text HTML / block content
  inkStrokes: Stroke[]; // vector ink strokes for S Pen / Apple Pencil
  inkPreviewUrl?: string; // cached low-res thumbnail
  inkBackground?: InkBackground; // ruled / grid / dotted page style
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
