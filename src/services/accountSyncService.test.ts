import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Note } from '../types/note';
import {
  getAllNotes,
  saveNote,
  deleteNote,
  setStorageNamespace,
  __resetStorageForTests
} from './storage';
import { syncAccountNotes } from './accountSyncService';

const makeNote = (id: string, overrides: Partial<Note> = {}): Note => ({
  id,
  title: 'Test Note',
  content: '<p>Hello</p>',
  inkStrokes: [],
  tags: ['Work'],
  color: '#3b82f6',
  createdAt: 1000,
  updatedAt: 2000,
  ...overrides
});

interface FakeServer {
  notes: Map<string, Note>;
  tombstones: Map<string, number>;
  calls: { method: string; path: string; body?: any }[];
}

function installFakeServer(seed: Note[] = []): FakeServer {
  const server: FakeServer = {
    notes: new Map(seed.map((note) => [note.id, note])),
    tombstones: new Map(),
    calls: []
  };

  const respond = (body: unknown, status = 200): Response =>
    new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      server.calls.push({ method, path, body });

      if (path === '/api/notes' && method === 'GET') {
        const notes = server.notes.size
          ? Array.from(server.notes.values()).map((note) => noteMeta(note))
          : [];
        for (const [id, deletedAt] of server.tombstones) {
          if (!server.notes.has(id)) {
            notes.push({
              id,
              title: '',
              tags: [],
              color: '',
              pinned: false,
              createdAt: deletedAt,
              updatedAt: deletedAt,
              deleted: true,
              sizeBytes: 0
            });
          }
        }
        return respond({ notes });
      }

      const match = path.match(/^\/api\/notes\/(.+)$/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        if (method === 'GET') {
          const note = server.notes.get(id);
          if (!note || server.tombstones.has(id)) return respond({ error: 'not found' }, 404);
          return respond(note);
        }
        if (method === 'PUT') {
          server.notes.set(id, body as Note);
          server.tombstones.delete(id);
          return respond({ ok: true, id, updatedAt: (body as Note).updatedAt });
        }
        if (method === 'DELETE') {
          server.notes.delete(id);
          server.tombstones.set(id, Date.now());
          return respond(null, 204);
        }
      }

      return respond({ error: 'unexpected request' }, 404);
    })
  );

  return server;
}

function noteMeta(note: Note) {
  return {
    id: note.id,
    title: note.title,
    tags: note.tags || [],
    color: note.color || '',
    pinned: !!note.pinned,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    deleted: false,
    sizeBytes: 0
  };
}

describe('Account Sync Service', () => {
  beforeEach(async () => {
    await __resetStorageForTests();
    setStorageNamespace('account-test-user');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setStorageNamespace(null);
  });

  it('uploads notes created while signed in', async () => {
    const server = installFakeServer();
    await saveNote(makeNote('local-note'));

    const result = await syncAccountNotes();

    expect(server.notes.has('local-note')).toBe(true);
    expect(result.pushed).toBe(1);
    expect(result.pulled).toBe(0);
    expect(server.calls.some((c) => c.method === 'PUT' && c.path === '/api/notes/local-note')).toBe(true);
  });

  it('downloads notes that only exist in the account', async () => {
    installFakeServer([makeNote('remote-note', { title: 'From Server', updatedAt: 5000 })]);

    const result = await syncAccountNotes();

    expect(result.pulled).toBe(1);
    const local = await getAllNotes();
    expect(local.map((n) => n.id)).toEqual(['remote-note']);
    expect(local[0].title).toBe('From Server');
  });

  it('pushes local deletions as tombstones', async () => {
    const server = installFakeServer([makeNote('to-delete', { updatedAt: 5000 })]);
    await saveNote(makeNote('to-delete', { updatedAt: 5000 }));

    await deleteNote('to-delete');
    await syncAccountNotes();

    expect(server.notes.has('to-delete')).toBe(false);
    expect(server.tombstones.has('to-delete')).toBe(true);
    expect(await getAllNotes()).toHaveLength(0);
  });

  it('removes notes deleted in another session', async () => {
    const server = installFakeServer();
    await saveNote(makeNote('deleted-elsewhere', { updatedAt: 2000 }));
    server.tombstones.set('deleted-elsewhere', Date.now());

    const result = await syncAccountNotes();

    expect(result.deleted).toBe(1);
    expect(await getAllNotes()).toHaveLength(0);
  });

  it('keeps the newer copy when both sides changed', async () => {
    const server = installFakeServer([makeNote('conflict', { title: 'Server', updatedAt: 4000 })]);
    await saveNote(makeNote('conflict', { title: 'Local', updatedAt: 6000 }));

    await syncAccountNotes();

    expect(server.notes.get('conflict')?.title).toBe('Local');
    expect((await getAllNotes())[0].title).toBe('Local');
  });
});
