import { expect, it } from 'vitest';
import type { Note } from '../types/note';
import { notePages, removeNotePage, updateNotePage } from './notePages';

it('preserves page identity and content when deleting the original first page', () => {
  const note: Note = {
    id: 'note', title: 'Notebook', content: '<p>Original</p>', inkStrokes: [], tags: [],
    color: '', createdAt: 1, updatedAt: 1, pageLayout: 'landscape', pageColor: '#e6ecdf',
    extraPages: [
      { id: 'next', content: '<p>Second</p>', inkStrokes: [], inkBackground: 'grid' },
      { id: 'last', content: '<p>Third</p>', inkStrokes: [] },
    ],
  };
  expect(notePages(note).map(({ id }) => id)).toEqual(['note', 'next', 'last']);
  const edited = updateNotePage(note, 'next', { recognizedText: 'Second-page OCR' });
  const promoted = removeNotePage(edited, 'note');
  expect(promoted).toMatchObject({ id: 'note', firstPageId: 'next', content: '<p>Second</p>',
    inkBackground: 'grid', recognizedText: 'Second-page OCR' });
  expect(promoted.pageColor).toBeUndefined();
  expect(promoted.pageLayout).toBeUndefined();
  expect(notePages(promoted).map(({ id }) => id)).toEqual(['next', 'last']);
  expect(updateNotePage(promoted, 'note', { content: '<p>Stale edit</p>' })).toBe(promoted);
  const remaining = removeNotePage(promoted, 'last');
  expect(removeNotePage(remaining, 'next')).toBe(remaining);
});
