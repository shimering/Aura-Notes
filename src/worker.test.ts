import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './worker';

const authState = vi.hoisted(() => ({
  configured: true,
  user: { id: 'current-account' } as { id: string } | null,
}));

vi.mock('./auth', () => ({
  getAuth: () =>
    authState.configured
      ? {
          auth: {
            api: {
              getSession: async () => (authState.user ? { user: authState.user } : null),
            },
            handler: vi.fn(),
          },
          googleEnabled: false,
        }
      : null,
}));

type WorkerEnv = Parameters<typeof worker.fetch>[1];
const ORIGIN = 'https://notes.example.test';

function makeEnv(overrides: Record<string, unknown> = {}): WorkerEnv {
  return { ASSETS: { fetch: vi.fn() }, ...overrides } as unknown as WorkerEnv;
}

interface StoredRow {
  userSub: string;
  id: string;
  title: string;
  tags: string;
  color: string;
  pinned: number;
  createdAt: number;
  updatedAt: number;
  deleted: number;
  sizeBytes: number;
}

/** Minimal in-memory D1 covering exactly the queries the Worker issues. */
function makeDb() {
  const rows = new Map<string, StoredRow>();
  const keyOf = (userSub: string, id: string) => `${userSub}::${id}`;

  const prepare = (query: string) => {
    const sql = query.replace(/\s+/g, ' ').trim();
    let values: unknown[] = [];

    const statement = {
      bind(...next: unknown[]) {
        values = next;
        return statement;
      },
      async first<T>() {
        if (sql.startsWith('SELECT deleted FROM notes')) {
          const row = rows.get(keyOf(String(values[0]), String(values[1])));
          return (row ? { deleted: row.deleted } : null) as T | null;
        }
        if (sql.startsWith('SELECT updated_at AS updatedAt')) {
          const row = rows.get(keyOf(String(values[0]), String(values[1])));
          return (row ? { updatedAt: row.updatedAt, deleted: row.deleted } : null) as T | null;
        }
        if (sql.startsWith('SELECT COUNT(*)')) {
          const mine = [...rows.values()].filter((row) => row.userSub === values[0]);
          return {
            total: mine.length,
            latest: mine.reduce((latest, row) => Math.max(latest, row.updatedAt), 0),
          } as T;
        }
        throw new Error(`Unexpected first() query: ${sql}`);
      },
      async all<T>() {
        const mine = [...rows.values()].filter((row) => row.userSub === values[0]);
        return { results: mine as unknown as T[] };
      },
      async run() {
        if (!sql.startsWith('INSERT INTO notes')) {
          throw new Error(`Unexpected run() query: ${sql}`);
        }
        if (sql.includes('deleted = 1')) {
          const [userSub, id, createdAt, updatedAt] = values as [string, string, number, number];
          const existing = rows.get(keyOf(userSub, id));
          rows.set(keyOf(userSub, id), {
            userSub,
            id,
            title: '',
            tags: '[]',
            color: '',
            pinned: 0,
            createdAt: existing?.createdAt ?? createdAt,
            updatedAt,
            deleted: 1,
            sizeBytes: 0,
          });
          return { meta: { changes: 1 } };
        }
        const [userSub, id, title, tags, color, pinned, createdAt, updatedAt, sizeBytes] = values as [
          string,
          string,
          string,
          string,
          string,
          number,
          number,
          number,
          number,
        ];
        rows.set(keyOf(userSub, id), {
          userSub,
          id,
          title,
          tags,
          color,
          pinned,
          createdAt,
          updatedAt,
          deleted: 0,
          sizeBytes,
        });
        return { meta: { changes: 1 } };
      },
    };

    return statement;
  };

  return { rows, prepare };
}

function makeBucket() {
  const objects = new Map<string, string>();
  return {
    objects,
    async get(key: string) {
      const value = objects.get(key);
      return value === undefined ? null : { text: async () => value };
    },
    async put(key: string, value: string) {
      objects.set(key, value);
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
}

function makeKv() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function noteBody(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: 'Ink study',
    content: '<p>hello</p>',
    inkStrokes: [{ id: 's1', points: [], color: '#1e293b', width: 2, tool: 'pen' }],
    tags: ['inbox'],
    color: '#8b5cf6',
    pinned: false,
    createdAt: 1_000,
    updatedAt: 2_000,
    ...overrides,
  };
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`${ORIGIN}${path}`, init);
}

describe('account notes API', () => {
  beforeEach(() => {
    authState.configured = true;
    authState.user = { id: 'current-account' };
  });

  it('rejects a sync request from a tab still showing another account', async () => {
    const prepare = vi.fn();
    const put = vi.fn();
    const response = await worker.fetch(
      new Request(`${ORIGIN}/api/notes/note-1`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'X-Aura-Account': 'previous-account',
        },
        body: JSON.stringify({ id: 'note-1', title: 'Offline note' }),
      }),
      makeEnv({ DB: { prepare }, NOTES_BUCKET: { put, get: vi.fn(), delete: vi.fn() } })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'auth_required' });
    expect(prepare).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('requires a signed-in session for every notes route', async () => {
    authState.user = null;
    const db = makeDb();
    const response = await worker.fetch(
      request('/api/notes'),
      makeEnv({ DB: db, NOTES_BUCKET: makeBucket() })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'auth_required' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(db.rows.size).toBe(0);
  });

  it('reports unavailable account storage instead of pretending to save', async () => {
    const response = await worker.fetch(request('/api/notes'), makeEnv());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'storage_not_configured' });
  });

  it('rejects cross-origin writes before touching storage', async () => {
    const db = makeDb();
    const bucket = makeBucket();
    const response = await worker.fetch(
      request('/api/notes/note-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
        body: JSON.stringify(noteBody('note-1')),
      }),
      makeEnv({ DB: db, NOTES_BUCKET: bucket })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'cross_origin' });
    expect(db.rows.size).toBe(0);
    expect(bucket.objects.size).toBe(0);
  });

  it('stores a note under the session user, ignoring client-supplied owners', async () => {
    const db = makeDb();
    const bucket = makeBucket();
    const response = await worker.fetch(
      request('/api/notes/note-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify(noteBody('note-1', { userSub: 'someone-else', userId: 'someone-else' })),
      }),
      makeEnv({ DB: db, NOTES_BUCKET: bucket })
    );

    expect(response.status).toBe(200);
    expect([...bucket.objects.keys()]).toEqual(['users/current-account/notes/note-1.json']);
    expect([...db.rows.values()].map((row) => [row.userSub, row.id])).toEqual([
      ['current-account', 'note-1'],
    ]);
    expect(JSON.parse(bucket.objects.get('users/current-account/notes/note-1.json')!)).toMatchObject({
      title: 'Ink study',
    });
  });

  it('refuses to overwrite a newer note with a stale copy', async () => {
    const db = makeDb();
    db.rows.set('current-account::note-1', {
      userSub: 'current-account',
      id: 'note-1',
      title: 'Newer',
      tags: '[]',
      color: '',
      pinned: 0,
      createdAt: 1_000,
      updatedAt: 5_000,
      deleted: 0,
      sizeBytes: 10,
    });
    const bucket = makeBucket();
    const response = await worker.fetch(
      request('/api/notes/note-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify(noteBody('note-1', { updatedAt: 2_000 })),
      }),
      makeEnv({ DB: db, NOTES_BUCKET: bucket })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'stale_write', updatedAt: 5_000 });
    expect(bucket.objects.size).toBe(0);
  });

  it('lists only the signed-in user’s notes', async () => {
    const db = makeDb();
    for (const userSub of ['user-a', 'current-account']) {
      db.rows.set(`${userSub}::shared`, {
        userSub,
        id: 'shared',
        title: `Note for ${userSub}`,
        tags: '["inbox"]',
        color: '',
        pinned: 0,
        createdAt: 1_000,
        updatedAt: 2_000,
        deleted: 0,
        sizeBytes: 10,
      });
    }
    authState.user = { id: 'user-a' };
    const response = await worker.fetch(
      request('/api/notes'),
      makeEnv({ DB: db, NOTES_BUCKET: makeBucket() })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      notes: [expect.objectContaining({ id: 'shared', title: 'Note for user-a', tags: ['inbox'] })],
    });
  });

  it('deletes notes as tombstones and removes the stored payload', async () => {
    const db = makeDb();
    const bucket = makeBucket();
    bucket.objects.set('users/current-account/notes/note-1.json', '{}');

    const response = await worker.fetch(
      request('/api/notes/note-1', { method: 'DELETE', headers: { Origin: ORIGIN } }),
      makeEnv({ DB: db, NOTES_BUCKET: bucket })
    );

    expect(response.status).toBe(204);
    expect(db.rows.get('current-account::note-1')).toMatchObject({ deleted: 1 });
    expect(bucket.objects.size).toBe(0);
  });

  it('validates the note id and payload', async () => {
    const db = makeDb();
    const env = makeEnv({ DB: db, NOTES_BUCKET: makeBucket() });

    const mismatched = await worker.fetch(
      request('/api/notes/note-2', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify(noteBody('note-1')),
      }),
      env
    );
    expect(mismatched.status).toBe(400);
    expect(await mismatched.json()).toMatchObject({ code: 'invalid_note' });

    const badId = await worker.fetch(
      request('/api/notes/bad%24id', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify(noteBody('bad$id')),
      }),
      env
    );
    expect(badId.status).toBe(400);
    expect(await badId.json()).toMatchObject({ code: 'invalid_note_id' });
    expect(db.rows.size).toBe(0);
  });
});

describe('vault sync API', () => {
  const VAULT_KEY = 'vault-key-123';

  it('rejects keys outside the documented shape', async () => {
    const response = await worker.fetch(
      request('/api/sync/vault/short'),
      makeEnv({ AURA_SYNC_KV: makeKv() })
    );

    expect(response.status).toBe(400);
  });

  it('merges last-write-wins, lets tombstones win, and only bumps rev on change', async () => {
    const kv = makeKv();
    const env = makeEnv({ AURA_SYNC_KV: kv });
    const post = (body: unknown) =>
      worker.fetch(
        request(`/api/sync/vault/${VAULT_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
        env
      );

    await post({ notes: [noteBody('n1', { updatedAt: 5_000, title: 'Newer' })], settings: {}, deletedNoteIds: [] });
    await post({ notes: [noteBody('n1', { updatedAt: 1_000, title: 'Older' })], settings: {}, deletedNoteIds: [] });

    const stored = JSON.parse(kv.store.get(`vault:${VAULT_KEY}`)!);
    expect(stored.notes).toHaveLength(1);
    expect(stored.notes[0].title).toBe('Newer');
    expect(stored.rev).toBe(1);

    await post({ notes: [noteBody('n1', { updatedAt: 5_000, title: 'Newer' })], settings: {}, deletedNoteIds: [] });
    expect(JSON.parse(kv.store.get(`vault:${VAULT_KEY}`)!).rev).toBe(1);

    await post({ notes: [], settings: {}, deletedNoteIds: ['n1'] });
    const afterDelete = JSON.parse(kv.store.get(`vault:${VAULT_KEY}`)!);
    expect(afterDelete.notes).toEqual([]);
    expect(afterDelete.deletedNoteIds).toEqual(['n1']);
  });

  it('breaks equal-clock ties towards the version with more strokes', async () => {
    const kv = makeKv();
    const env = makeEnv({ AURA_SYNC_KV: kv });
    const post = (body: unknown) =>
      worker.fetch(
        request(`/api/sync/vault/${VAULT_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
        env
      );

    await post({ notes: [noteBody('n1', { updatedAt: 2_000 })], settings: {}, deletedNoteIds: [] });
    const richer = noteBody('n1', {
      updatedAt: 2_000,
      inkStrokes: [
        { id: 's1', points: [], color: '#000', width: 2, tool: 'pen' },
        { id: 's2', points: [], color: '#000', width: 2, tool: 'pen' },
      ],
    });
    await post({ notes: [richer], settings: {}, deletedNoteIds: [] });

    const stored = JSON.parse(kv.store.get(`vault:${VAULT_KEY}`)!);
    expect(stored.notes[0].inkStrokes).toHaveLength(2);
  });
});

describe('push channel', () => {
  it('answers the baseline revision without holding the request', async () => {
    const kv = makeKv();
    const response = await worker.fetch(
      request(`/api/sync/vault/vault-key-123/watch`),
      makeEnv({ AURA_SYNC_KV: kv })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ changed: false, version: 0 });
  });
});
