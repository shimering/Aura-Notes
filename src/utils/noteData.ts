import type { Note, NotePageData } from '../types/note';
import { sanitizeNoteHtml } from './noteHtml';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStroke(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.color === 'string'
    && isFiniteNumber(value.width) && value.width > 0
    && (value.tool === 'pen' || value.tool === 'fountain' || value.tool === 'highlighter' || value.tool === 'eraser')
    && (value.opacity === undefined || isFiniteNumber(value.opacity))
    && (value.groupId === undefined || typeof value.groupId === 'string')
    && (value.layer === undefined || value.layer === 'front' || value.layer === 'back')
    && Array.isArray(value.points)
    && value.points.every((point: unknown) => isRecord(point) &&
      [point.x, point.y, point.pressure, point.time].every(isFiniteNumber));
}

function isPageData(value: Record<string, unknown>): value is Record<string, unknown> & NotePageData {
  return typeof value.content === 'string'
    && Array.isArray(value.inkStrokes) && value.inkStrokes.every(isStroke)
    && (value.recognizedText === undefined || typeof value.recognizedText === 'string')
    && (value.inkBackground === undefined || value.inkBackground === 'none'
      || value.inkBackground === 'ruled' || value.inkBackground === 'grid' || value.inkBackground === 'dotted')
    && (value.pageLayout === undefined || value.pageLayout === 'portrait'
      || value.pageLayout === 'landscape' || value.pageLayout === 'canvas')
    && (value.textLayout === undefined || (isRecord(value.textLayout)
      && [value.textLayout.x, value.textLayout.y, value.textLayout.rotation].every(isFiniteNumber)
      && isFiniteNumber(value.textLayout.scale) && value.textLayout.scale > 0));
}

export function parseNoteData(value: unknown): Note | null {
  if (!isRecord(value) || !isPageData(value)
    || typeof value.id !== 'string' || !value.id.trim()
    || typeof value.title !== 'string'
    || !isFiniteNumber(value.createdAt) || !isFiniteNumber(value.updatedAt)
    || !Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === 'string')
    || typeof value.color !== 'string'
    || (value.pinned !== undefined && typeof value.pinned !== 'boolean')
    || (value.firstPageId !== undefined && (typeof value.firstPageId !== 'string' || !value.firstPageId.trim()))
    || (value.extraPages !== undefined && !Array.isArray(value.extraPages))) return null;

  const note = { ...value, content: sanitizeNoteHtml(value.content) } as unknown as Note;
  if (Array.isArray(value.extraPages)) {
    const ids = new Set([note.firstPageId ?? note.id]);
    note.extraPages = [];
    for (const page of value.extraPages as unknown[]) {
      if (!isRecord(page) || !isPageData(page) || typeof page.id !== 'string' || !page.id.trim() || ids.has(page.id)) return null;
      ids.add(page.id);
      note.extraPages.push({ ...page, id: page.id, content: sanitizeNoteHtml(page.content) });
    }
  }
  return note;
}
