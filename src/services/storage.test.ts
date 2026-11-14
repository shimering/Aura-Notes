import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAllNotes,
  saveNote,
  deleteNote,
  getNoteById,
  compactNote,
  setStorageNamespace,
  __resetStorageForTests,
  __seedLegacyNotesForTests
} from './storage';
import { Note } from '../types/note';

const makeNote = (id: string, overrides: Partial<Note> = {}): Note => ({
  id,
  title: 'Test Note Title',
  content: '<p>Hello World</p>',
  inkStrokes: [],
  tags: ['Work'],
  color: '#3b82f6',
  createdAt: 1000,
  updatedAt: 2000,
  ...overrides
});

describe('Storage Service', () => {
  const testNote = makeNote('test-note-1');

  beforeEach(async () => {
    await __resetStorageForTests();
  });

  it('saves and retrieves a note', async () => {
    await saveNote(testNote);
    const retrieved = await getNoteById('test-note-1');
    expect(retrieved).toBeDefined();
    expect(retrieved?.title).toBe('Test Note Title');
  });

  it('updates an existing note', async () => {
    await saveNote(testNote);
    await saveNote({ ...testNote, title: 'Updated Title', updatedAt: 3000 });

    const retrieved = await getNoteById('test-note-1');
    expect(retrieved?.title).toBe('Updated Title');
  });

  it('stores notes as independent records', async () => {
    await saveNote(makeNote('note-a', { title: 'A', updatedAt: 1000 }));
    await saveNote(makeNote('note-b', { title: 'B', updatedAt: 2000 }));
    await saveNote(makeNote('note-a', { title: 'A2', updatedAt: 3000 }));

    const all = await getAllNotes();
    expect(all.map((n) => n.title).sort()).toEqual(['A2', 'B']);
  });

  it('sorts pinned notes first, then by most recently updated', async () => {
    await saveNote(makeNote('older', { updatedAt: 1000 }));
    await saveNote(makeNote('newer', { updatedAt: 3000 }));
    await saveNote(makeNote('pinned', { updatedAt: 2000, pinned: true }));

    const all = await getAllNotes();
    expect(all[0].id).toBe('pinned');
    expect(all[1].id).toBe('newer');
    expect(all[2].id).toBe('older');
  });

  it('deletes a note', async () => {
    await saveNote(testNote);
    await deleteNote('test-note-1');
    const retrieved = await getNoteById('test-note-1');
    expect(retrieved).toBeUndefined();
  });

  it('migrates a legacy single-blob notes list', async () => {
    await __seedLegacyNotesForTests([
      makeNote('legacy-1', { title: 'Legacy One' }),
      makeNote('legacy-2', { title: 'Legacy Two' })
    ]);

    const all = await getAllNotes();
    expect(all.map((n) => n.id).sort()).toEqual(['legacy-1', 'legacy-2']);

    // A second load should read the migrated per-note records.
    const reloaded = await getAllNotes();
    expect(reloaded).toHaveLength(2);
  });

  it('compacts ink coordinate precision on save', async () => {
    const note = makeNote('ink-note', {
      inkStrokes: [
        {
          id: 's1',
          points: [{ x: 10.123456, y: 20.987654, pressure: 0.333333, time: 5 }],
          color: '#000',
          width: 4,
          tool: 'fountain'
        }
      ]
    });

    const compacted = compactNote(note);
    expect(compacted.inkStrokes[0].points[0]).toEqual({
      x: 10.1,
      y: 21,
      pressure: 0.33,
      time: 5
    });

    await saveNote(note);
    const stored = await getNoteById('ink-note');
    expect(stored?.inkStrokes[0].points[0].x).toBe(10.1);
  });

  it('keeps account namespaces separate from device notes', async () => {
    await saveNote(makeNote('device-note', { title: 'Device Only' }));

    setStorageNamespace('freebuff-user-123');
    const accountNotes = await getAllNotes();
    expect(accountNotes).toHaveLength(0); // accounts start empty, no welcome note

    await saveNote(makeNote('account-note', { title: 'Account Only' }));
    expect((await getAllNotes()).map((n) => n.id)).toEqual(['account-note']);
    expect(await getNoteById('device-note')).toBeUndefined();

    setStorageNamespace(null);
    const deviceNotes = await getAllNotes();
    expect(deviceNotes.map((n) => n.id)).toEqual(['device-note']);
    expect(await getNoteById('account-note')).toBeUndefined();
  });

  it('gives each account its own namespace', async () => {
    setStorageNamespace('user-a');
    await saveNote(makeNote('a-note'));

    setStorageNamespace('user-b');
    expect(await getAllNotes()).toHaveLength(0);

    setStorageNamespace('user-a');
    expect((await getAllNotes()).map((n) => n.id)).toEqual(['a-note']);
  });
});
