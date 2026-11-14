import { createFreebuffAuth, isSameOriginRequest, type FreebuffAuth } from '@freebuff/auth';

interface D1PreparedStatementLike {
  bind: (...values: unknown[]) => D1PreparedStatementLike;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<{ results?: T[] }>;
  run: () => Promise<{ meta?: { changes?: number } }>;
}

interface D1DatabaseLike {
  prepare: (query: string) => D1PreparedStatementLike;
}

interface R2ObjectBodyLike {
  text: () => Promise<string>;
}

interface R2BucketLike {
  get: (key: string) => Promise<R2ObjectBodyLike | null>;
  put: (key: string, value: string, options?: { httpMetadata?: { contentType?: string } }) => Promise<unknown>;
  delete: (key: string) => Promise<void>;
}

interface AuthUser {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  email_verified?: boolean;
}

interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
  AURA_SYNC_KV?: {
    get: (key: string) => Promise<string | null>;
    put: (key: string, value: string) => Promise<void>;
  };
  /** D1 database for users and per-user note metadata. */
  DB?: D1DatabaseLike;
  /** R2 bucket holding full note payloads (rich text + ink strokes). */
  NOTES_BUCKET?: R2BucketLike;
  /** Public client ID from `npx @freebuff/auth register`. Not a secret. */
  FREEBUFF_CLIENT_ID?: string;
  /** Only set for a non-production Freebuff issuer. */
  FREEBUFF_ISSUER?: string;
  /** Canonical site origin, e.g. https://aura-notes-pwa.gazarxperia.workers.dev. */
  APP_ORIGIN?: string;
}

// In-memory fallback if KV is not configured on Cloudflare
const memoryVaultStore = new Map<string, string>();

const MAX_SYNC_PAYLOAD_BYTES = 20 * 1024 * 1024;
const MAX_TOMBSTONES = 5000;
const VAULT_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...extraHeaders, 'Content-Type': 'application/json' }
  });
}

interface AuthRuntime {
  wrap: (request: Request, env: Env) => Promise<Response>;
  getUser: (request: Request) => Promise<AuthUser | null>;
}

// One auth instance per isolate caches discovery documents and signing keys.
let authRuntime: AuthRuntime | null = null;
let authRuntimeKey = '';

function getAuthRuntime(env: Env): AuthRuntime | null {
  const clientId = env.FREEBUFF_CLIENT_ID?.trim();
  const origin = (env.APP_ORIGIN || '').trim().replace(/\/+$/, '');
  if (!clientId || !origin) return null;

  const cacheKey = `${clientId}|${origin}|${env.FREEBUFF_ISSUER || ''}`;
  if (authRuntime && authRuntimeKey === cacheKey) return authRuntime;

  let auth: FreebuffAuth;
  try {
    auth = createFreebuffAuth({
      clientId,
      baseUrl: origin,
      ...(env.FREEBUFF_ISSUER ? { issuer: env.FREEBUFF_ISSUER } : {}),
    });
  } catch (error) {
    // A bad client ID or origin must never take the notes app down: sign-in is
    // optional, local editing and the anonymous vault keep working without it.
    console.error(
      'Sign in with Freebuff is misconfigured:',
      error instanceof Error ? error.message : 'unknown error'
    );
    authRuntime = null;
    authRuntimeKey = '';
    return null;
  }

  authRuntime = {
    // `wrap` serves /auth/freebuff/* and refreshes the session cookie.
    wrap: auth.wrap(handleRequest),
    getUser: (request) => auth.getUser(request),
  };
  authRuntimeKey = cacheKey;
  return authRuntime;
}

/* ----------------------------- Account storage ---------------------------- */

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const NOTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_NOTE_BYTES = 10 * 1024 * 1024;
const MAX_NOTE_TAGS = 100;

interface NoteMetaRow {
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

function noteObjectKey(userSub: string, noteId: string): string {
  // Encode the subject so an unusual `sub` cannot create stray key segments.
  return `users/${encodeURIComponent(userSub)}/notes/${noteId}.json`;
}

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((tag): tag is string => typeof tag === 'string');
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((tag): tag is string => typeof tag === 'string')
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function getRequestUser(request: Request, env: Env): Promise<AuthUser | null> {
  const runtime = getAuthRuntime(env);
  if (!runtime) return null;
  try {
    const user = await runtime.getUser(request);
    return user && typeof user.sub === 'string' && user.sub ? user : null;
  } catch (error) {
    console.warn('Could not read Freebuff session:', error instanceof Error ? error.message : 'unknown');
    return null;
  }
}

async function ensureUserRow(db: D1DatabaseLike, user: AuthUser): Promise<void> {
  const now = Date.now();
  // Only touch the row when the profile actually changed, so steady-state
  // requests stay read-only.
  await db
    .prepare(
      `INSERT INTO users (sub, email, name, picture, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(sub) DO UPDATE SET
         email = excluded.email,
         name = excluded.name,
         picture = excluded.picture,
         updated_at = excluded.updated_at
       WHERE users.email IS NOT excluded.email
          OR users.name IS NOT excluded.name
          OR users.picture IS NOT excluded.picture`
    )
    .bind(user.sub, user.email ?? null, user.name ?? null, user.picture ?? null, now, now)
    .run();
}

async function requireAccount(
  request: Request,
  env: Env
): Promise<{ user: AuthUser; db: D1DatabaseLike; bucket: R2BucketLike } | Response> {
  const runtime = getAuthRuntime(env);
  if (!runtime) {
    return jsonResponse(
      { error: 'Sign in with Freebuff is not configured yet', code: 'auth_not_configured' },
      503,
      NO_STORE
    );
  }
  if (!env.DB || !env.NOTES_BUCKET) {
    return jsonResponse(
      { error: 'Account storage is not configured', code: 'storage_not_configured' },
      503,
      NO_STORE
    );
  }

  const user = await getRequestUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Sign in required', code: 'auth_required' }, 401, NO_STORE);
  }

  try {
    await ensureUserRow(env.DB, user);
  } catch (error) {
    console.warn('Could not upsert user row:', error instanceof Error ? error.message : 'unknown');
  }

  return { user, db: env.DB, bucket: env.NOTES_BUCKET };
}

async function listNotes(userSub: string, db: D1DatabaseLike): Promise<Response> {
  const { results } = await db
    .prepare(
      `SELECT id, title, tags, color, pinned,
              created_at AS createdAt, updated_at AS updatedAt,
              deleted, size_bytes AS sizeBytes
       FROM notes
       WHERE user_sub = ?
       ORDER BY updated_at DESC`
    )
    .bind(userSub)
    .all<NoteMetaRow>();

  const notes = (results || []).map((row) => ({
    id: row.id,
    title: row.title || '',
    tags: parseTags(row.tags),
    color: row.color || '',
    pinned: !!row.pinned,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deleted: !!row.deleted,
    sizeBytes: row.sizeBytes || 0
  }));

  return jsonResponse({ notes }, 200, NO_STORE);
}

async function getNote(
  userId: string,
  db: D1DatabaseLike,
  bucket: R2BucketLike,
  noteId: string
): Promise<Response> {
  const row = await db
    .prepare('SELECT deleted FROM notes WHERE user_sub = ? AND id = ?')
    .bind(userId, noteId)
    .first<{ deleted: number }>();

  if (!row || row.deleted) {
    return jsonResponse({ error: 'Note not found', code: 'not_found' }, 404, NO_STORE);
  }

  const object = await bucket.get(noteObjectKey(userId, noteId));
  if (!object) {
    return jsonResponse({ error: 'Note content not found', code: 'not_found' }, 404, NO_STORE);
  }

  return new Response(await object.text(), {
    status: 200,
    headers: { ...NO_STORE, 'Content-Type': 'application/json' }
  });
}

function validateNote(value: unknown, noteId: string): string | null {
  if (!value || typeof value !== 'object') return 'Note must be a JSON object';
  const note = value as Record<string, unknown>;
  if (note.id !== noteId) return 'Note id must match the URL';
  if (typeof note.title !== 'string') return 'Note title must be a string';
  if (typeof note.content !== 'string') return 'Note content must be a string';
  if (!Array.isArray(note.inkStrokes)) return 'Note inkStrokes must be an array';
  if (!Array.isArray(note.tags)) return 'Note tags must be an array';
  if (!Number.isFinite(note.createdAt) || !Number.isFinite(note.updatedAt)) {
    return 'Note timestamps must be numbers';
  }
  if ((note.createdAt as number) <= 0 || (note.updatedAt as number) <= 0) {
    return 'Note timestamps must be positive';
  }
  return null;
}

async function putNote(
  request: Request,
  userId: string,
  db: D1DatabaseLike,
  bucket: R2BucketLike,
  noteId: string
): Promise<Response> {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_NOTE_BYTES) {
    return jsonResponse({ error: 'Note is too large', code: 'too_large' }, 413, NO_STORE);
  }

  const raw = await request.text();
  if (raw.length > MAX_NOTE_BYTES) {
    return jsonResponse({ error: 'Note is too large', code: 'too_large' }, 413, NO_STORE);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return jsonResponse({ error: 'Note body must be valid JSON', code: 'invalid_json' }, 400, NO_STORE);
  }

  const invalid = validateNote(parsed, noteId);
  if (invalid) {
    return jsonResponse({ error: invalid, code: 'invalid_note' }, 400, NO_STORE);
  }

  const note = parsed as {
    id: string;
    title: string;
    content: string;
    inkStrokes: unknown[];
    tags: string[];
    color?: string;
    pinned?: boolean;
    createdAt: number;
    updatedAt: number;
  };

  const existing = await db
    .prepare('SELECT updated_at AS updatedAt, deleted FROM notes WHERE user_sub = ? AND id = ?')
    .bind(userId, noteId)
    .first<{ updatedAt: number; deleted: number }>();

  if (existing && !existing.deleted && existing.updatedAt > note.updatedAt) {
    return jsonResponse(
      { error: 'A newer version of this note already exists', code: 'stale_write', updatedAt: existing.updatedAt },
      409,
      NO_STORE
    );
  }

  const body = JSON.stringify(note);
  await bucket.put(noteObjectKey(userId, noteId), body, {
    httpMetadata: { contentType: 'application/json' }
  });

  const tags = note.tags
    .filter((tag): tag is string => typeof tag === 'string')
    .slice(0, MAX_NOTE_TAGS);

  await db
    .prepare(
      `INSERT INTO notes
         (user_sub, id, title, tags, color, pinned, created_at, updated_at, deleted, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(user_sub, id) DO UPDATE SET
         title = excluded.title,
         tags = excluded.tags,
         color = excluded.color,
         pinned = excluded.pinned,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         deleted = 0,
         size_bytes = excluded.size_bytes`
    )
    .bind(
      userId,
      noteId,
      note.title,
      JSON.stringify(tags),
      typeof note.color === 'string' ? note.color : '',
      note.pinned ? 1 : 0,
      note.createdAt,
      note.updatedAt,
      body.length
    )
    .run();

  return jsonResponse({ ok: true, id: noteId, updatedAt: note.updatedAt }, 200, NO_STORE);
}

async function deleteNote(
  userId: string,
  db: D1DatabaseLike,
  bucket: R2BucketLike,
  noteId: string
): Promise<Response> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO notes
         (user_sub, id, title, tags, color, pinned, created_at, updated_at, deleted, size_bytes)
       VALUES (?, ?, '', '[]', '', 0, ?, ?, 1, 0)
       ON CONFLICT(user_sub, id) DO UPDATE SET
         deleted = 1,
         updated_at = excluded.updated_at,
         size_bytes = 0`
    )
    .bind(userId, noteId, now, now)
    .run();

  await bucket.delete(noteObjectKey(userId, noteId));
  return new Response(null, { status: 204, headers: NO_STORE });
}

async function handleNotesApi(request: Request, env: Env, noteId?: string): Promise<Response> {
  const account = await requireAccount(request, env);
  if (account instanceof Response) return account;

  const { user, db, bucket } = account;
  const method = request.method.toUpperCase();

  if (!noteId) {
    if (method !== 'GET') {
      return jsonResponse({ error: 'Method not allowed' }, 405, NO_STORE);
    }
    return listNotes(user.sub, db);
  }

  if (!NOTE_ID_PATTERN.test(noteId)) {
    return jsonResponse({ error: 'Invalid note id', code: 'invalid_note_id' }, 400, NO_STORE);
  }

  if (method === 'GET') {
    return getNote(user.sub, db, bucket, noteId);
  }

  if (method !== 'PUT' && method !== 'DELETE') {
    return jsonResponse({ error: 'Method not allowed' }, 405, NO_STORE);
  }

  const origin = (env.APP_ORIGIN || '').trim().replace(/\/+$/, '');
  if (!origin || !isSameOriginRequest(request, origin)) {
    return jsonResponse({ error: 'Cross-origin request rejected', code: 'cross_origin' }, 403, NO_STORE);
  }

  if (method === 'PUT') {
    return putNote(request, user.sub, db, bucket, noteId);
  }
  return deleteNote(user.sub, db, bucket, noteId);
}

/**
 * Signed-in account API. Returns the current user and persists their account
 * row in D1 so the first request from a new visitor registers them.
 */
async function handleAccountApi(request: Request, env: Env): Promise<Response> {
  const runtime = getAuthRuntime(env);
  if (!runtime) {
    return jsonResponse(
      { error: 'Sign in with Freebuff is not configured yet', code: 'auth_not_configured' },
      503,
      NO_STORE
    );
  }

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, NO_STORE);
  }

  const user = await getRequestUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Sign in required' }, 401, NO_STORE);
  }

  if (env.DB) {
    try {
      await ensureUserRow(env.DB, user);
    } catch (error) {
      console.warn('Could not upsert user row:', error instanceof Error ? error.message : 'unknown');
    }
  }

  return jsonResponse({ user }, 200, NO_STORE);
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/account') {
      return handleAccountApi(request, env);
    }

    // Per-user note storage: /api/notes and /api/notes/:id
    const notesMatch = url.pathname.match(/^\/api\/notes(?:\/([^/]+))?\/?$/);
    if (notesMatch) {
      let noteId: string | undefined;
      if (notesMatch[1] !== undefined) {
        try {
          noteId = decodeURIComponent(notesMatch[1]);
        } catch {
          return jsonResponse({ error: 'Invalid note id', code: 'invalid_note_id' }, 400, NO_STORE);
        }
      }
      return handleNotesApi(request, env, noteId);
    }


    // CORS headers for cross-origin or local dev requests
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Sync API routes: /api/sync/vault/:key
    if (url.pathname.startsWith('/api/sync/vault/')) {
      const vaultKey = decodeURIComponent(url.pathname.replace('/api/sync/vault/', '')).trim();
      if (!vaultKey) {
        return jsonResponse({ error: 'Vault key is required' }, 400, corsHeaders);
      }
      if (!VAULT_KEY_PATTERN.test(vaultKey)) {
        return jsonResponse(
          { error: 'Vault key must be 8–128 characters using letters, numbers, dashes, or underscores' },
          400,
          corsHeaders
        );
      }

      const declaredLength = Number(request.headers.get('content-length') || 0);
      if (declaredLength > MAX_SYNC_PAYLOAD_BYTES) {
        return jsonResponse({ error: 'Sync payload too large' }, 413, corsHeaders);
      }

      const storageKey = `vault:${vaultKey}`;

      if (request.method === 'GET') {
        let storedData: string | null = null;
        if (env.AURA_SYNC_KV) {
          storedData = await env.AURA_SYNC_KV.get(storageKey);
        } else {
          storedData = memoryVaultStore.get(storageKey) || null;
        }

        if (!storedData) {
          return jsonResponse({ notes: [], settings: {}, updatedAt: 0 }, 200, corsHeaders);
        }

        return new Response(storedData, {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (request.method === 'POST') {
        try {
          const body = await request.json() as any;
          const incomingNotes = Array.isArray(body.notes) ? body.notes : [];
          const incomingSettings = body.settings || {};
          const incomingDeleted = Array.isArray(body.deletedNoteIds) ? body.deletedNoteIds : [];

          // Fetch existing vault
          let existingDataStr: string | null = null;
          if (env.AURA_SYNC_KV) {
            existingDataStr = await env.AURA_SYNC_KV.get(storageKey);
          } else {
            existingDataStr = memoryVaultStore.get(storageKey) || null;
          }

          let existingVault = { 
            notes: [] as any[], 
            settings: {} as any, 
            deletedNoteIds: [] as string[], 
            updatedAt: 0 
          };

          if (existingDataStr) {
            try {
              existingVault = JSON.parse(existingDataStr);
            } catch {}
          }

          // Merge deleted IDs (bounded so the tombstone list cannot grow forever)
          const allDeleted = Array.from(
            new Set([...(existingVault.deletedNoteIds || []), ...incomingDeleted])
          ).slice(-MAX_TOMBSTONES);
          const deletedSet = new Set(allDeleted);

          // Merge notes by ID with Last-Write-Wins (LWW)
          const noteMap = new Map<string, any>();
          for (const n of existingVault.notes || []) {
            if (!deletedSet.has(n.id)) {
              noteMap.set(n.id, n);
            }
          }
          for (const inNote of incomingNotes) {
            if (deletedSet.has(inNote.id)) continue;
            const existing = noteMap.get(inNote.id);
            if (!existing) {
              noteMap.set(inNote.id, inNote);
            } else {
              const inTime = inNote.updatedAt || 0;
              const exTime = existing.updatedAt || 0;
              if (inTime > exTime) {
                noteMap.set(inNote.id, inNote);
              } else if (inTime === exTime) {
                // Equal clocks: prefer the version that clearly carries more work,
                // otherwise keep the server copy to avoid flip-flopping.
                const inStrokes = inNote.inkStrokes?.length || 0;
                const exStrokes = existing.inkStrokes?.length || 0;
                if (inStrokes > exStrokes) {
                  noteMap.set(inNote.id, inNote);
                } else if (inStrokes === exStrokes &&
                  (inNote.content?.length || 0) > (existing.content?.length || 0)) {
                  noteMap.set(inNote.id, inNote);
                }
              }
            }
          }

          // Merge settings
          const existingSettingsTime = existingVault.settings?.updatedAt || 0;
          const incomingSettingsTime = incomingSettings.updatedAt || 0;
          const mergedSettings = incomingSettingsTime >= existingSettingsTime
            ? { ...existingVault.settings, ...incomingSettings }
            : { ...incomingSettings, ...existingVault.settings };

          const mergedVault = {
            vaultKey,
            notes: Array.from(noteMap.values()),
            settings: mergedSettings,
            deletedNoteIds: allDeleted,
            updatedAt: Date.now()
          };

          const mergedVaultStr = JSON.stringify(mergedVault);
          if (mergedVaultStr.length > MAX_SYNC_PAYLOAD_BYTES) {
            return jsonResponse(
              { error: 'Vault exceeds the maximum sync size. Remove large ink drawings or export a local backup.' },
              413,
              corsHeaders
            );
          }

          if (env.AURA_SYNC_KV) {
            await env.AURA_SYNC_KV.put(storageKey, mergedVaultStr);
          } else {
            memoryVaultStore.set(storageKey, mergedVaultStr);
          }

          return new Response(mergedVaultStr, {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (err: any) {
          return jsonResponse({ error: err.message || 'Sync failed' }, 500, corsHeaders);
        }
      }

      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const runtime = getAuthRuntime(env);
    // Auth must run before static assets so /auth/freebuff/* is not swallowed
    // by the SPA fallback (assets.run_worker_first is set in wrangler config).
    if (!runtime) return handleRequest(request, env);
    return runtime.wrap(request, env);
  }
};
