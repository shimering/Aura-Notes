import { createStore, get, set, set as setDefault, del, entries, clear, promisifyRequest } from 'idb-keyval';
import { Note, Stroke } from '../types/note';
import { notePages } from '../utils/notePages';
import { getDeletedNoteTombstones, recordDeletedNoteId } from './syncService';

// Anonymous device storage. Signed-in visitors get their own namespace so an
// account's notes never mix with the notes already on this device.
const ANON_NOTES_DB = 'aura-notes-db';
const ANON_META_DB = 'aura-notes-meta';

// Per-note records live in their own object store so a single edit rewrites only
// the affected note instead of the entire notes array.
let notesStore = createStore(ANON_NOTES_DB, 'notes');
// Separate database on purpose: idb-keyval creates one object store per DB
// version, so requesting a second store from the same DB would never be created.
let metaStore = createStore(ANON_META_DB, 'meta');

// Legacy single-blob key (pre-v2). Migrated on first load and then deleted.
const LEGACY_NOTES_KEY = 'aura_notes_list';
const MIGRATED_KEY = 'aura_notes_migrated_v2';
const WELCOME_SHOWN_KEY = 'aura_welcome_shown';
const ACTIVE_NOTE_ID_KEY = 'aura_active_note_id';

/** Current storage owner: null for the signed-out device namespace. */
let namespaceUserId: string | null = null;

// In-memory fallback for environments without indexedDB (Node tests, strict private browsing)
interface MemoryNamespace {
  notes: Map<string, Note>;
  meta: Map<string, any>;
  legacy?: Note[];
}

const memoryNamespaces = new Map<string, MemoryNamespace>();

function hasIndexedDB(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

function memoryNamespace(): MemoryNamespace {
  const key = namespaceUserId ? `user:${namespaceUserId}` : 'anonymous';
  let entry = memoryNamespaces.get(key);
  if (!entry) {
    entry = { notes: new Map(), meta: new Map() };
    memoryNamespaces.set(key, entry);
  }
  return entry;
}

/** Short stable hash so sanitized storage names cannot collide. */
function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Points local storage at one visitor's namespace.
 *
 * `null` selects the signed-out device namespace (existing notes, welcome note,
 * legacy migration). A Better Auth user id selects that account's own namespace,
 * which starts empty and never seeds the welcome note.
 */
export function setStorageNamespace(userId: string | null): void {
  const next = typeof userId === 'string' && userId.trim() ? userId.trim() : null;
  namespaceUserId = next;

  if (!next) {
    notesStore = createStore(ANON_NOTES_DB, 'notes');
    metaStore = createStore(ANON_META_DB, 'meta');
    return;
  }

  const safeId = next.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  const tag = `${safeId}-${hashString(next)}`;
  notesStore = createStore(`aura-notes-user-${tag}`, 'notes');
  metaStore = createStore(`aura-notes-user-${tag}-meta`, 'meta');
}

/** Which namespace storage currently targets (account user id, or null). */
export function getStorageNamespace(): string | null {
  return namespaceUserId;
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
  const compactStrokes = (strokes: Stroke[]) => strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((p) => ({
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      pressure: Math.round(p.pressure * 100) / 100,
      time: p.time
    }))
  }));
  const extraPages = notePages(note).slice(1);
  if (!note.inkStrokes?.length && !extraPages.some((page) => page.inkStrokes.length)) return note;
  return {
    ...note,
    inkStrokes: compactStrokes(note.inkStrokes ?? []),
    ...(extraPages.length && { extraPages: extraPages.map((page) => ({ ...page, inkStrokes: compactStrokes(page.inkStrokes) })) }),
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
  return Array.from(memoryNamespace().notes.values());
}

async function writeAllNotes(notes: Note[]): Promise<void> {
  const records = notes.map(compactNote);
  if (hasIndexedDB()) {
    await notesStore('readwrite', (store) => {
      store.clear();
      for (const note of records) store.put(note, note.id);
      return promisifyRequest(store.transaction);
    });
    return;
  }
  const memory = memoryNamespace();
  memory.notes.clear();
  for (const note of records) {
    memory.notes.set(note.id, note);
  }
}

export async function applyNoteChanges(notes: Note[], deletedIds: ReadonlySet<string> = new Set()): Promise<void> {
  const records = notes.map(compactNote);
  if (hasIndexedDB()) {
    await notesStore('readwrite', (store) => {
      for (const id of deletedIds) store.delete(id);
      for (const note of records) store.put(note, note.id);
      return promisifyRequest(store.transaction);
    });
  } else {
    const { notes: local } = memoryNamespace();
    for (const id of deletedIds) local.delete(id);
    for (const note of records) local.set(note.id, note);
  }
}

/** Apply a pull only if the local revision still matches the sync snapshot. */
export async function applyAccountPull(id: string, previous: Note | undefined, next: Note | null): Promise<boolean> {
  const record = next ? compactNote(next) : null;
  if (!hasIndexedDB()) {
    const { notes } = memoryNamespace();
    if (notes.get(id)?.updatedAt !== previous?.updatedAt) return false;
    if (record) notes.set(id, record);
    else notes.delete(id);
    return true;
  }
  return notesStore('readwrite', (store) => {
    let applied = false;
    const request = store.get(id);
    request.onsuccess = () => {
      if (request.result?.updatedAt !== previous?.updatedAt) return;
      if (record) store.put(record, id);
      else store.delete(id);
      applied = true;
    };
    return promisifyRequest(store.transaction).then(() => applied);
  });
}

async function readMeta<T>(key: string): Promise<T | undefined> {
  if (hasIndexedDB()) {
    return await get<T>(key, metaStore);
  }
  return memoryNamespace().meta.get(key);
}

async function writeMeta(key: string, value: any): Promise<void> {
  if (hasIndexedDB()) {
    await set(key, value, metaStore);
    return;
  }
  memoryNamespace().meta.set(key, value);
}

async function readLegacyNotes(): Promise<Note[] | undefined> {
  if (hasIndexedDB()) {
    return await get<Note[]>(LEGACY_NOTES_KEY);
  }
  return memoryNamespace().legacy;
}

/**
 * Migrates the pre-v2 single notes blob into per-note records exactly once.
 * Only the signed-out device namespace has a legacy blob.
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
        memoryNamespace().legacy = undefined;
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

    // The signed-out device namespace owns the legacy blob and welcome note.
    // Account namespaces start empty and stay empty until notes are created.
    if (namespaceUserId === null) {
      if (notes.length === 0) {
        const migrated = await migrateLegacyNotesIfNeeded();
        if (migrated) notes = migrated;
      }

      const hasWelcome = notes.some((note) => note.id === INITIAL_WELCOME_NOTE.id);
      const shouldCheckWelcome = hasWelcome || notes.length === 0;
      if (shouldCheckWelcome && !(await readMeta<boolean>(WELCOME_SHOWN_KEY))) {
        const deleted = await getDeletedNoteTombstones();
        if (!hasWelcome && !Object.hasOwn(deleted, INITIAL_WELCOME_NOTE.id)) {
          await saveNote(INITIAL_WELCOME_NOTE);
          notes = [INITIAL_WELCOME_NOTE];
        }
        await writeMeta(WELCOME_SHOWN_KEY, true);
      }
    }

    return sortNotes(notes);
  } catch (error) {
    console.error('Failed to load notes from storage:', error);
    if (namespaceUserId === null) {
      // Never silently surface an empty notebook if the legacy blob is readable.
      try {
        const legacy = await readLegacyNotes();
        if (legacy && legacy.length > 0) return sortNotes(legacy);
      } catch {
        // ignore
      }
      return [INITIAL_WELCOME_NOTE];
    }
    return [];
  }
}

export async function getNoteById(id: string): Promise<Note | undefined> {
  try {
    if (hasIndexedDB()) {
      return await get<Note>(id, notesStore);
    }
    return memoryNamespace().notes.get(id);
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
      memoryNamespace().notes.set(stored.id, stored);
    }
  } catch (error) {
    console.error('Failed to save note to storage:', error);
    throw error;
  }
}

/**
 * Removes a note and records a tombstone so cloud syncs propagate the delete.
 */
export async function deleteNote(id: string): Promise<void> {
  try {
    await recordDeletedNoteId(id);
    await removeNoteRecord(id);
  } catch (error) {
    console.error('Failed to delete note from storage:', error);
    throw error;
  }
}

async function removeNoteRecord(id: string): Promise<void> {
  if (hasIndexedDB()) {
    await del(id, notesStore);
  } else {
    memoryNamespace().notes.delete(id);
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
 * Test helper: clears IndexedDB stores and every in-memory namespace, and
 * returns storage to the signed-out device namespace.
 */
export async function __resetStorageForTests(): Promise<void> {
  setStorageNamespace(null);
  if (hasIndexedDB()) {
    await clear(notesStore);
    await clear(metaStore);
  }
  memoryNamespaces.clear();
}

/**
 * Test helper: seeds a legacy single-blob payload to exercise migration.
 */
export async function __seedLegacyNotesForTests(notes: Note[]): Promise<void> {
  if (hasIndexedDB()) {
    await setDefault(LEGACY_NOTES_KEY, notes);
    return;
  }
  memoryNamespace().legacy = notes;
}
