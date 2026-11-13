import { createStore, get, set, set as setDefault, del, entries, setMany, clear } from 'idb-keyval';
import { Note } from '../types/note';
import { recordDeletedNoteId } from './syncService';

// Per-note records live in their own object store so a single edit rewrites only
// the affected note instead of the entire notes array.
const notesStore = createStore('aura-notes-db', 'notes');
// Separate database on purpose: idb-keyval creates one object store per DB
// version, so requesting a second store from the same DB would never be created.
const metaStore = createStore('aura-notes-meta', 'meta');

// Legacy single-blob key (pre-v2). Migrated on first load and then deleted.
const LEGACY_NOTES_KEY = 'aura_notes_list';
const MIGRATED_KEY = 'aura_notes_migrated_v2';
const ACTIVE_NOTE_ID_KEY = 'aura_active_note_id';

// In-memory fallback for environments without indexedDB (Node tests, strict private browsing)
const memoryNotes = new Map<string, Note>();
const memoryMeta = new Map<string, any>();
let memoryLegacyNotes: Note[] | undefined;

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

/**
 * Trims float noise from ink points before persisting. Cuts record size by a
 * meaningful amount without visible fidelity loss.
 */
export function compactNote(note: Note): Note {
  if (!note.inkStrokes || note.inkStrokes.length === 0) return note;

  return {
    ...note,
    inkStrokes: note.inkStrokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((p) => ({
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        pressure: Math.round(p.pressure * 100) / 100,
        time: p.time
      }))
    }))
  };
}

function sortNotes(notes: Note[]): Note[] {
  return notes.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });
}

async function readAllNotes(): Promise<Note[]> {
  if (hasIndexedDB()) {
    const rows = await entries<string, Note>(notesStore);
    return rows.map(([, note]) => note).filter(Boolean);
  }
  return Array.from(memoryNotes.values());
}

async function writeAllNotes(notes: Note[]): Promise<void> {
  if (hasIndexedDB()) {
    await clear(notesStore);
    if (notes.length > 0) {
      await setMany(notes.map((n) => [n.id, compactNote(n)] as [string, Note]), notesStore);
    }
    return;
  }
  memoryNotes.clear();
  for (const note of notes) {
    memoryNotes.set(note.id, compactNote(note));
  }
}

async function readMeta<T>(key: string): Promise<T | undefined> {
  if (hasIndexedDB()) {
    return await get<T>(key, metaStore);
  }
  return memoryMeta.get(key);
}

async function writeMeta(key: string, value: any): Promise<void> {
  if (hasIndexedDB()) {
    await set(key, value, metaStore);
    return;
  }
  memoryMeta.set(key, value);
}

async function readLegacyNotes(): Promise<Note[] | undefined> {
  if (hasIndexedDB()) {
    return await get<Note[]>(LEGACY_NOTES_KEY);
  }
  return memoryLegacyNotes;
}

/**
 * Migrates the pre-v2 single notes blob into per-note records exactly once.
 */
async function migrateLegacyNotesIfNeeded(): Promise<Note[] | null> {
  try {
    const migrated = await readMeta<boolean>(MIGRATED_KEY);
    if (migrated) return null;

    const legacy = await readLegacyNotes();
    await writeMeta(MIGRATED_KEY, true);

    if (!legacy || legacy.length === 0) return null;

    await writeAllNotes(legacy);
    try {
      if (hasIndexedDB()) {
        await del(LEGACY_NOTES_KEY);
      } else {
        memoryLegacyNotes = undefined;
      }
    } catch {
      // Non-fatal: keep the legacy key around if deletion fails.
    }
    return legacy;
  } catch (error) {
    console.warn('Legacy note migration skipped:', error);
    return null;
  }
}

export async function getAllNotes(): Promise<Note[]> {
  try {
    let notes = await readAllNotes();

    if (notes.length === 0) {
      const migrated = await migrateLegacyNotesIfNeeded();
      if (migrated) notes = migrated;
    }

    if (notes.length === 0) {
      await saveNote(INITIAL_WELCOME_NOTE);
      return [INITIAL_WELCOME_NOTE];
    }
    return sortNotes(notes);
  } catch (error) {
    console.error('Failed to load notes from storage:', error);
    // Never silently surface an empty notebook if the legacy blob is readable.
    try {
      const legacy = await readLegacyNotes();
      if (legacy && legacy.length > 0) return sortNotes(legacy);
    } catch {
      // ignore
    }
    return [INITIAL_WELCOME_NOTE];
  }
}

export async function getNoteById(id: string): Promise<Note | undefined> {
  try {
    if (hasIndexedDB()) {
      return await get<Note>(id, notesStore);
    }
    return memoryNotes.get(id);
  } catch (error) {
    console.error('Failed to load note from storage:', error);
    return undefined;
  }
}

export async function saveNote(note: Note): Promise<void> {
  try {
    const stored = compactNote({
      ...note,
      updatedAt: note.updatedAt || Date.now()
    });

    if (hasIndexedDB()) {
      await set(stored.id, stored, notesStore);
    } else {
      memoryNotes.set(stored.id, stored);
    }
  } catch (error) {
    console.error('Failed to save note to storage:', error);
    throw error;
  }
}

export async function saveAllNotes(notes: Note[]): Promise<void> {
  try {
    await writeAllNotes(notes);
  } catch (error) {
    console.error('Failed to save notes list:', error);
    throw error;
  }
}

export async function deleteNote(id: string): Promise<void> {
  try {
    await recordDeletedNoteId(id);

    if (hasIndexedDB()) {
      await del(id, notesStore);
    } else {
      memoryNotes.delete(id);
    }
  } catch (error) {
    console.error('Failed to delete note from storage:', error);
    throw error;
  }
}

export async function getActiveNoteId(): Promise<string | undefined> {
  try {
    return await readMeta<string>(ACTIVE_NOTE_ID_KEY);
  } catch {
    return undefined;
  }
}

export async function setActiveNoteId(id: string): Promise<void> {
  try {
    await writeMeta(ACTIVE_NOTE_ID_KEY, id);
  } catch (error) {
    console.error('Failed to save active note ID:', error);
  }
}

/**
 * Test helper: clears both IndexedDB stores and the in-memory fallback.
 */
export async function __resetStorageForTests(): Promise<void> {
  if (hasIndexedDB()) {
    await clear(notesStore);
    await clear(metaStore);
  }
  memoryNotes.clear();
  memoryMeta.clear();
  memoryLegacyNotes = undefined;
}

/**
 * Test helper: seeds a legacy single-blob payload to exercise migration.
 */
export async function __seedLegacyNotesForTests(notes: Note[]): Promise<void> {
  if (hasIndexedDB()) {
    await setDefault(LEGACY_NOTES_KEY, notes);
    return;
  }
  memoryLegacyNotes = notes;
}
