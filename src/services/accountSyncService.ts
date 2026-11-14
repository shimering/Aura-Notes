import { Note } from '../types/note';
import { getAllNotes, saveNote, deleteNoteLocally } from './storage';
import { getDeletedNoteTombstones } from './syncService';

/**
 * Account sync: one signed-in visitor's notes stored in Cloudflare.
 *
 * Metadata (title, tags, timestamps, tombstones) lives in D1 and the full note
 * payload lives in R2, both keyed by the Better Auth user id on the server. This
 * module only ever talks to the site's own origin, so the session cookie stays
 * HttpOnly and the client never sees a token.
 */

const NOTES_URL = '/api/notes';

export interface AccountNoteMeta {
  id: string;
  title: string;
  tags: string[];
  color: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
  sizeBytes: number;
}

export interface AccountSyncResult {
  notes: Note[];
  pushed: number;
  pulled: number;
  deleted: number;
  lastSyncedAt: number;
}

export type AccountSyncErrorCode =
  | 'auth_required'
  | 'storage_unavailable'
  | 'offline'
  | 'network'
  | 'http';

export class AccountSyncError extends Error {
  code: AccountSyncErrorCode;

  constructor(message: string, code: AccountSyncErrorCode) {
    super(message);
    this.name = 'AccountSyncError';
    this.code = code;
  }
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

async function errorMessageFor(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body?.error || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function toSyncError(response: Response): Promise<AccountSyncError> {
  if (response.status === 401) {
    return new AccountSyncError('Sign in to sync your notes.', 'auth_required');
  }
  if (response.status === 503) {
    return new AccountSyncError('Account storage is not available yet.', 'storage_unavailable');
  }
  return new AccountSyncError(await errorMessageFor(response), 'http');
}

async function requestNotes(path: string, init?: RequestInit): Promise<Response> {
  if (isOffline()) {
    throw new AccountSyncError('You are offline. Notes stay on this device until you reconnect.', 'offline');
  }
  try {
    return await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {})
      }
    });
  } catch {
    throw new AccountSyncError('Could not reach note storage. Check your connection.', 'network');
  }
}

export async function listAccountNotes(): Promise<AccountNoteMeta[]> {
  const response = await requestNotes(NOTES_URL);
  if (!response.ok) throw await toSyncError(response);

  const body = (await response.json()) as { notes?: AccountNoteMeta[] };
  return Array.isArray(body.notes) ? body.notes : [];
}

export async function fetchAccountNote(id: string): Promise<Note | null> {
  const response = await requestNotes(`${NOTES_URL}/${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw await toSyncError(response);

  try {
    return (await response.json()) as Note;
  } catch {
    return null;
  }
}

/**
 * Uploads one note. Returns false when the server already holds a newer
 * version (409), so the caller can pull on the next pass instead.
 */
export async function pushAccountNote(note: Note): Promise<boolean> {
  const response = await requestNotes(`${NOTES_URL}/${encodeURIComponent(note.id)}`, {
    method: 'PUT',
    body: JSON.stringify(note)
  });

  if (response.status === 409) return false;
  if (!response.ok) throw await toSyncError(response);
  return true;
}

export async function deleteAccountNote(id: string): Promise<void> {
  const response = await requestNotes(`${NOTES_URL}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  // A note that is already gone is the desired end state.
  if (response.status === 404) return;
  if (!response.ok) throw await toSyncError(response);
}

/**
 * Two-way sync with last-write-wins semantics and server-side tombstones.
 *
 * Deletions made on this device are pushed from the local tombstone list;
 * deletions made elsewhere remove the local copy. Notes edited locally during
 * the sync are preserved by the caller.
 */
export async function syncAccountNotes(): Promise<AccountSyncResult> {
  const remoteNotes = await listAccountNotes();
  const tombstones = await getDeletedNoteTombstones();
  const localNotes = await getAllNotes();

  const remoteById = new Map(remoteNotes.map((meta) => [meta.id, { ...meta }]));
  const resultById = new Map(localNotes.map((note) => [note.id, note]));

  let pushed = 0;
  let pulled = 0;
  let deleted = 0;

  // 1. Push local deletions that the server still has as live notes.
  for (const [id, deletedAt] of Object.entries(tombstones)) {
    const remote = remoteById.get(id);
    if (!remote || remote.deleted) continue;

    const localNote = resultById.get(id);
    if (localNote && (localNote.updatedAt || 0) > deletedAt) continue; // re-created after the delete

    await deleteAccountNote(id);
    remoteById.set(id, { ...remote, deleted: true, updatedAt: Math.max(remote.updatedAt, deletedAt) });
    deleted += 1;
  }

  // 2. Apply deletions made on other devices, unless this copy is newer.
  for (const meta of remoteById.values()) {
    if (!meta.deleted) continue;

    const localNote = resultById.get(meta.id);
    if (!localNote) continue;

    if ((localNote.updatedAt || 0) > meta.updatedAt) {
      if (await pushAccountNote(localNote)) {
        pushed += 1;
        remoteById.set(meta.id, { ...meta, deleted: false, updatedAt: localNote.updatedAt });
      }
      continue;
    }

    await deleteNoteLocally(meta.id);
    resultById.delete(meta.id);
    deleted += 1;
  }

  // 3. Upload notes the server has never seen or holds an older copy of.
  for (const note of Array.from(resultById.values())) {
    const meta = remoteById.get(note.id);
    if (meta && !meta.deleted && meta.updatedAt >= (note.updatedAt || 0)) continue;

    if (await pushAccountNote(note)) {
      pushed += 1;
      remoteById.set(note.id, {
        id: note.id,
        title: note.title,
        tags: note.tags || [],
        color: note.color || '',
        pinned: !!note.pinned,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        deleted: false,
        sizeBytes: meta?.sizeBytes || 0
      });
    }
  }

  // 4. Download notes that are new or newer on the server.
  for (const meta of Array.from(remoteById.values())) {
    if (meta.deleted) continue;

    const localNote = resultById.get(meta.id);
    if (localNote && (localNote.updatedAt || 0) >= meta.updatedAt) continue;

    const fetched = await fetchAccountNote(meta.id);
    if (!fetched) continue;

    if (localNote && (localNote.updatedAt || 0) > (fetched.updatedAt || 0)) continue;

    await saveNote(fetched);
    resultById.set(fetched.id, fetched);
    pulled += 1;
  }

  const notes = Array.from(resultById.values()).sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });

  return { notes, pushed, pulled, deleted, lastSyncedAt: Date.now() };
}
