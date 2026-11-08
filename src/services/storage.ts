import { get, set, del } from 'idb-keyval';
import { Note } from '../types/note';
import { recordDeletedNoteId } from './syncService';

const NOTES_KEY = 'aura_notes_list';
const ACTIVE_NOTE_ID_KEY = 'aura_active_note_id';

// In-memory fallback for environments without indexedDB (e.g. Node tests, strict private browsing)
const memoryStorage: Record<string, any> = {};

function hasIndexedDB(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

const INITIAL_WELCOME_NOTE: Note = {
  id: 'welcome-to-aura',
  title: '✨ Welcome to Aura Notes Studio',
  content: `
    <h2>Welcome to your elegant handwriting &amp; keyboard note studio!</h2>
    <p>Aura Notes is built from the ground up for <strong>Samsung Galaxy Tabs (S Pen)</strong>, <strong>iPads (Apple Pencil)</strong>, and desktop keyboards.</p>
    <br/>
    <h3>🌟 What makes this special:</h3>
    <ul>
      <li><strong>Stylus &amp; S Pen / Apple Pencil:</strong> 120Hz smooth inking with real pressure sensitivity and palm rejection. Use the button on your S Pen or flip to erase!</li>
      <li><strong>Scribble to Text:</strong> Write anywhere by hand on the canvas, then tap <mark style="background-color: #fef08a; padding: 2px 6px; border-radius: 4px;">Convert Scribble to Text</mark> to instantly transcribe your handwriting into formatted text!</li>
      <li><strong>Rich Text &amp; Vibrant Colors:</strong> Select any text to apply bold, italic, headings, or custom color palettes.</li>
      <li><strong>Offline &amp; PWA:</strong> Works completely offline without cloud servers. Install to your iPad or Galaxy Tab home screen!</li>
    </ul>
    <br/>
    <p><em>Grab your stylus or start typing to begin your first note!</em></p>
  `,
  inkStrokes: [],
  tags: ['Welcome', 'Guide'],
  color: '#8b5cf6',
  pinned: true,
  createdAt: Date.now() - 3600000,
  updatedAt: Date.now()
};

export async function getAllNotes(): Promise<Note[]> {
  try {
    let notes: Note[] | undefined;
    if (hasIndexedDB()) {
      notes = await get<Note[]>(NOTES_KEY);
    } else {
      notes = memoryStorage[NOTES_KEY];
    }

    if (!notes || notes.length === 0) {
      await saveNote(INITIAL_WELCOME_NOTE);
      return [INITIAL_WELCOME_NOTE];
    }
    return notes.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.updatedAt - a.updatedAt;
    });
  } catch (error) {
    console.error('Failed to load notes from storage:', error);
    return [INITIAL_WELCOME_NOTE];
  }
}

export async function getNoteById(id: string): Promise<Note | undefined> {
  const notes = await getAllNotes();
  return notes.find((n) => n.id === id);
}

export async function saveNote(note: Note): Promise<void> {
  try {
    let notes: Note[] = [];
    if (hasIndexedDB()) {
      notes = (await get<Note[]>(NOTES_KEY)) || [];
    } else {
      notes = memoryStorage[NOTES_KEY] || [];
    }

    const index = notes.findIndex((n) => n.id === note.id);
    const updatedNote = {
      ...note,
      updatedAt: note.updatedAt || Date.now()
    };

    if (index >= 0) {
      notes[index] = updatedNote;
    } else {
      notes.unshift(updatedNote);
    }

    if (hasIndexedDB()) {
      await set(NOTES_KEY, notes);
    } else {
      memoryStorage[NOTES_KEY] = notes;
    }
  } catch (error) {
    console.error('Failed to save note to storage:', error);
    throw error;
  }
}

export async function saveAllNotes(notes: Note[]): Promise<void> {
  try {
    if (hasIndexedDB()) {
      await set(NOTES_KEY, notes);
    } else {
      memoryStorage[NOTES_KEY] = notes;
    }
  } catch (error) {
    console.error('Failed to save notes list:', error);
    throw error;
  }
}

export async function deleteNote(id: string): Promise<void> {
  try {
    await recordDeletedNoteId(id);

    let notes: Note[] = [];
    if (hasIndexedDB()) {
      notes = (await get<Note[]>(NOTES_KEY)) || [];
    } else {
      notes = memoryStorage[NOTES_KEY] || [];
    }

    const filtered = notes.filter((n) => n.id !== id);

    if (hasIndexedDB()) {
      await set(NOTES_KEY, filtered);
    } else {
      memoryStorage[NOTES_KEY] = filtered;
    }
  } catch (error) {
    console.error('Failed to delete note from storage:', error);
    throw error;
  }
}

export async function getActiveNoteId(): Promise<string | undefined> {
  try {
    if (hasIndexedDB()) {
      return await get<string>(ACTIVE_NOTE_ID_KEY);
    }
    return memoryStorage[ACTIVE_NOTE_ID_KEY];
  } catch {
    return undefined;
  }
}

export async function setActiveNoteId(id: string): Promise<void> {
  try {
    if (hasIndexedDB()) {
      await set(ACTIVE_NOTE_ID_KEY, id);
    } else {
      memoryStorage[ACTIVE_NOTE_ID_KEY] = id;
    }
  } catch (error) {
    console.error('Failed to save active note ID:', error);
  }
}
