import { expect, it } from 'vitest';
import { parseNoteData } from './noteData';

const base = {
  id: 'note', title: 'Notebook', content: '<p>Hello</p>', inkStrokes: [],
  tags: [], color: '', createdAt: 1, updatedAt: 1,
};

it('keeps a saved page colour and rejects arbitrary CSS colours', () => {
  expect(parseNoteData({ ...base, pageColor: '#e6ecdf' })?.pageColor).toBe('#e6ecdf');
  expect(parseNoteData({ ...base, pageColor: undefined })?.pageColor).toBeUndefined();
  expect(parseNoteData({ ...base, pageColor: 'sage' })).toBeNull();
  expect(parseNoteData({ ...base, pageColor: 'url(javascript:alert(1))' })).toBeNull();
});
