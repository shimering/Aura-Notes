import { describe, it, expect, beforeEach } from 'vitest';
import { getAllNotes, saveNote, deleteNote, getNoteById } from './storage';
import { Note } from '../types/note';

describe('Storage Service', () => {
  const testNote: Note = {
    id: 'test-note-1',
    title: 'Test Note Title',
    content: '<p>Hello World</p>',
    inkStrokes: [],
    tags: ['Work'],
    color: '#3b82f6',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  it('saves and retrieves a note', async () => {
    await saveNote(testNote);
    const retrieved = await getNoteById('test-note-1');
    expect(retrieved).toBeDefined();
    expect(retrieved?.title).toBe('Test Note Title');
  });

  it('updates an existing note', async () => {
    await saveNote(testNote);
    const updatedNote = { ...testNote, title: 'Updated Title' };
    await saveNote(updatedNote);

    const retrieved = await getNoteById('test-note-1');
    expect(retrieved?.title).toBe('Updated Title');
  });

  it('deletes a note', async () => {
    await saveNote(testNote);
    await deleteNote('test-note-1');
    const retrieved = await getNoteById('test-note-1');
    expect(retrieved).toBeUndefined();
  });
});
