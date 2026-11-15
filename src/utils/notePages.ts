import type { Note, NotePage, NotePageData } from '../types/note';

function pageData({ content, inkStrokes, inkPreviewUrl, inkBackground, pageLayout, textLayout, recognizedText }: NotePageData): NotePageData {
  return { content, inkStrokes, inkPreviewUrl, inkBackground, pageLayout, textLayout, recognizedText };
}

export function notePages(note: Note): NotePage[] {
  const first = { id: note.firstPageId ?? note.id, ...pageData(note) };
  const ids = new Set([first.id]);
  const extraPages = Array.isArray(note.extraPages) ? note.extraPages.filter((page) => {
    if (!page || typeof page.id !== 'string' || ids.has(page.id) ||
        typeof page.content !== 'string' || !Array.isArray(page.inkStrokes)) return false;
    ids.add(page.id);
    return true;
  }) : [];
  return [first, ...extraPages];
}

export function updateNotePage(note: Note, pageId: string, update: Partial<NotePageData>): Note {
  if (pageId === (note.firstPageId ?? note.id)) return { ...note, ...update };
  const extraPages = notePages(note).slice(1);
  if (!extraPages.some((page) => page.id === pageId)) return note;
  return { ...note, extraPages: extraPages.map((page) => page.id === pageId ? { ...page, ...update } : page) };
}

export function removeNotePage(note: Note, pageId: string): Note {
  const pages = notePages(note).filter((page) => page.id !== pageId);
  if (!pages.length) return note;
  const [first, ...extraPages] = pages;
  return { ...note, ...pageData(first), firstPageId: first.id === note.id ? undefined : first.id,
    extraPages: extraPages.length ? extraPages : undefined };
}
