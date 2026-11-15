import { getAuth } from './auth';

interface D1PreparedStatementLike {
  bind: (...values: unknown[]) => D1PreparedStatementLike;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<{ results?: T[] }>;
  run: () => Promise<{ meta?: { changes?: number } }>;
}

interface D1DatabaseLike {
  prepare: (query: string) => D1PreparedStatementLike;
  batch?: (statements: D1PreparedStatementLike[]) => Promise<unknown>;
  exec?: (query: string) => Promise<unknown>;
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
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  emailVerified?: boolean;
}

interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
  AURA_SYNC_KV?: {
    get: (key: string) => Promise<string | null>;
    put: (key: string, value: string) => Promise<void>;
  };
  /** D1 database for Better Auth users/sessions and per-user note metadata. */
  DB?: D1DatabaseLike;
  /** R2 bucket holding full note payloads (rich text + ink strokes). */
  NOTES_BUCKET?: R2BucketLike;
  /** Canonical site origin, used for same-origin write checks. */
  APP_ORIGIN?: string;
  /** Better Auth signing secret (Worker secret, at least 32 characters). */
  BETTER_AUTH_SECRET?: string;
  /** Google OAuth client credentials (Worker secrets). */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

// In-memory fallback if KV is not configured on Cloudflare
const memoryVaultStore = new Map<string, string>();

const MAX_SYNC_PAYLOAD_BYTES = 20 * 1024 * 1024;
const MAX_TOMBSTONES = 5000;
const VAULT_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
/** How long a push request is held open before answering "nothing changed". */
const WATCH_HOLD_MS = 18000;
/** How often a held request re-reads storage. */
const VAULT_WATCH_POLL_MS = 750;
const NOTES_WATCH_POLL_MS = 1200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface StoredVault {
  vaultKey?: string;
  notes?: any[];
  settings?: any;
  deletedNoteIds?: string[];
  updatedAt?: number;
  /** Bumped only when the vault content really changes. */
  rev?: number;
  /** Device id of the last upload, used to avoid waking the writer itself. */
  lastWriter?: string;
}

/**
 * Serialization-independent identity of a vault. Every note edit bumps its
 * `updatedAt`, so comparing clocks is enough to tell whether anything new
 * arrived, and two identical merges can never ping-pong a revision bump.
 */
function vaultFingerprint(vault: StoredVault): string {
  const notes = (vault.notes || [])
    .map((note) => `${String(note?.id ?? '')}@${Number(note?.updatedAt) || 0}`)
    .sort();
  const deleted = [...(vault.deletedNoteIds || [])].map(String).sort();
  const settings = Object.keys(vault.settings || {})
    .sort()
    .map((key) => [key, vault.settings[key]]);
  return JSON.stringify([notes, deleted, settings]);
}

async function readVault(env: Env, storageKey: string): Promise<{ raw: string | null; vault: StoredVault }> {
  let raw: string | null = null;
  if (env.AURA_SYNC_KV) {
    raw = await env.AURA_SYNC_KV.get(storageKey);
  } else {
    raw = memoryVaultStore.get(storageKey) || null;
  }
  if (!raw) return { raw: null, vault: {} };
  try {
    return { raw, vault: JSON.parse(raw) as StoredVault };
  } catch {
    return { raw: null, vault: {} };
  }
}

async function writeVault(env: Env, storageKey: string, serialized: string): Promise<void> {
  if (env.AURA_SYNC_KV) {
    await env.AURA_SYNC_KV.put(storageKey, serialized);
  } else {
    memoryVaultStore.set(storageKey, serialized);
  }
}

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...extraHeaders, 'Content-Type': 'application/json' }
  });
}

function requestOrigin(request: Request): string {
  try {
    return new URL(request.url).origin;
  } catch {
    return '';
  }
}

/**
 * Rejects cross-origin writes while allowing non-browser clients (curl, tests)
 * that send no origin metadata. Browsers always send at least one of these.
 */
function isSameOriginRequest(request: Request, origin: string): boolean {
  const expected = origin.trim().replace(/\/+$/, '');
  if (!expected) return false;

  const originHeader = request.headers.get('origin');
  if (originHeader) return originHeader === expected;

  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }

  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite) return fetchSite === 'same-origin';

  return true;
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

function noteObjectKey(userId: string, noteId: string): string {
  // Encode the user id so unusual characters cannot create stray key segments.
  return `users/${encodeURIComponent(userId)}/notes/${noteId}.json`;
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
  const config = getAuth(env, requestOrigin(request));
  if (!config) return null;
  try {
    const result = await config.auth.api.getSession({ headers: request.headers });
    const user = result?.user;
    if (!user || typeof user.id !== 'string' || !user.id) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      emailVerified: user.emailVerified
    };
  } catch (error) {
    console.warn('Could not read auth session:', error instanceof Error ? error.message : 'unknown');
    return null;
  }
}

async function requireAccount(
  request: Request,
  env: Env
): Promise<{ user: AuthUser; db: D1DatabaseLike; bucket: R2BucketLike } | Response> {
  const config = getAuth(env, requestOrigin(request));
  if (!config) {
    return jsonResponse(
      { error: 'Account sign-in is not configured yet', code: 'auth_not_configured' },
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

  return { user, db: env.DB, bucket: env.NOTES_BUCKET };
}

async function listNotes(userId: string, db: D1DatabaseLike): Promise<Response> {
  const { results } = await db
    .prepare(
      `SELECT id, title, tags, color, pinned,
              created_at AS createdAt, updated_at AS updatedAt,
              deleted, size_bytes AS sizeBytes
       FROM notes
       WHERE user_sub = ?
       ORDER BY updated_at DESC`
    )
    .bind(userId)
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
    return listNotes(user.id, db);
  }

  if (!NOTE_ID_PATTERN.test(noteId)) {
    return jsonResponse({ error: 'Invalid note id', code: 'invalid_note_id' }, 400, NO_STORE);
  }

  if (method === 'GET') {
    return getNote(user.id, db, bucket, noteId);
  }

  if (method !== 'PUT' && method !== 'DELETE') {
    return jsonResponse({ error: 'Method not allowed' }, 405, NO_STORE);
  }

  const expectedOrigin = requestOrigin(request);
  if (!expectedOrigin || !isSameOriginRequest(request, expectedOrigin)) {
    return jsonResponse({ error: 'Cross-origin request rejected', code: 'cross_origin' }, 403, NO_STORE);
  }

  if (method === 'PUT') {
    return putNote(request, user.id, db, bucket, noteId);
  }
  return deleteNote(user.id, db, bucket, noteId);
}

/**
 * Reports whether sign-in is configured and which providers are enabled. The
 * client hides the account panel when auth routes are absent entirely.
 */
function handleAuthConfig(request: Request, env: Env): Response {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, NO_STORE);
  }
  const config = getAuth(env, requestOrigin(request));
  return jsonResponse(
    { available: Boolean(config), google: Boolean(config?.googleEnabled) },
    200,
    NO_STORE
  );
}

/* ------------------------------ Push channel ------------------------------ */

/**
 * Holds one request open per device and answers only once another device has
 * written to the vault. Idle devices therefore send a request every ~18s
 * instead of polling on a timer, and updates arrive within a second.
 */
async function handleVaultWatch(
  request: Request,
  env: Env,
  vaultKey: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const sinceParam = url.searchParams.get('v');
  const deviceId = (url.searchParams.get('device') || '').slice(0, 128);
  const storageKey = `vault:${vaultKey}`;
  const headers = { ...corsHeaders, 'Cache-Control': 'private, no-store' };

  let { vault } = await readVault(env, storageKey);
  const currentRev = vault.rev || 0;

  // A client without a revision is asking for the baseline.
  if (sinceParam === null || sinceParam.trim() === '') {
    return jsonResponse({ changed: false, version: currentRev }, 200, headers);
  }

  const since = Number(sinceParam);
  if (!Number.isFinite(since)) {
    return jsonResponse({ changed: false, version: currentRev }, 200, headers);
  }

  const deadline = Date.now() + WATCH_HOLD_MS;
  let rev = currentRev;
  let lastWriter = vault.lastWriter || '';

  while (rev === since && Date.now() < deadline) {
    await sleep(VAULT_WATCH_POLL_MS);
    vault = (await readVault(env, storageKey)).vault;
    rev = vault.rev || 0;
    lastWriter = vault.lastWriter || '';
  }

  // A device is never woken by its own upload.
  const changed = rev !== since && (!deviceId || lastWriter !== deviceId);
  return jsonResponse({ changed, version: rev }, 200, headers);
}

async function notesVersion(userId: string, db: D1DatabaseLike): Promise<string> {
  const row = await db
    .prepare('SELECT COUNT(*) AS total, MAX(updated_at) AS latest FROM notes WHERE user_sub = ?')
    .bind(userId)
    .first<{ total: number | null; latest: number | null }>();
  return `${Number(row?.latest) || 0}.${Number(row?.total) || 0}`;
}

/** Same hanging-GET contract for a signed-in account's notes. */
async function handleNotesWatch(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, NO_STORE);
  }

  const account = await requireAccount(request, env);
  if (account instanceof Response) return account;

  const url = new URL(request.url);
  const since = url.searchParams.get('v');
  let version = await notesVersion(account.user.id, account.db);

  if (!since || since.trim() === '') {
    return jsonResponse({ changed: false, version }, 200, NO_STORE);
  }

  const deadline = Date.now() + WATCH_HOLD_MS;
  while (version === since && Date.now() < deadline) {
    await sleep(NOTES_WATCH_POLL_MS);
    version = await notesVersion(account.user.id, account.db);
  }

  return jsonResponse({ changed: version !== since, version }, 200, NO_STORE);
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/auth-config') {
      return handleAuthConfig(request, env);
    }

    // Better Auth serves /api/auth/*: sign-up, sign-in, OAuth callbacks and
    // session cookies. It must run before static assets (run_worker_first).
    if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
      const config = getAuth(env, requestOrigin(request));
      if (!config) {
        return jsonResponse(
          { error: 'Account sign-in is not configured yet', code: 'auth_not_configured' },
          503,
          NO_STORE
        );
      }
      return config.auth.handler(request);
    }

    // Push channel for account sync: answers when this user's notes change.
    if (url.pathname === '/api/notes/watch') {
      return handleNotesWatch(request, env);
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

    // Push channel: holds the request open until another device writes.
    const vaultWatchMatch = url.pathname.match(/^\/api\/sync\/vault\/([^/]+)\/watch\/?$/);
    if (vaultWatchMatch) {
      let watchKey = '';
      try {
        watchKey = decodeURIComponent(vaultWatchMatch[1]).trim();
      } catch {
        return jsonResponse({ error: 'Invalid vault key' }, 400, corsHeaders);
      }
      if (!VAULT_KEY_PATTERN.test(watchKey)) {
        return jsonResponse({ error: 'Invalid vault key' }, 400, corsHeaders);
      }
      return handleVaultWatch(request, env, watchKey, corsHeaders);
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
        const { raw } = await readVault(env, storageKey);
        if (!raw) {
          return jsonResponse(
            { notes: [], settings: {}, deletedNoteIds: [], updatedAt: 0, rev: 0 },
            200,
            corsHeaders
          );
        }
        return new Response(raw, {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (request.method === 'POST') {
        try {
          const body = await request.json() as any;
          const incomingNotes = Array.isArray(body.notes) ? body.notes : [];
          const incomingSettings = body.settings || {};
          const incomingDeleted = Array.isArray(body.deletedNoteIds) ? body.deletedNoteIds : [];

          const { vault: existingVault } = await readVault(env, storageKey);

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

          const mergedVault: StoredVault = {
            vaultKey,
            notes: Array.from(noteMap.values()),
            settings: mergedSettings,
            deletedNoteIds: allDeleted,
            updatedAt: existingVault.updatedAt || 0,
            rev: existingVault.rev || 0,
            lastWriter: existingVault.lastWriter || ''
          };

          // Only a real content change bumps the revision that wakes other
          // devices; an idempotent re-sync must not start a notify loop.
          if (vaultFingerprint(mergedVault) !== vaultFingerprint(existingVault)) {
            mergedVault.updatedAt = Date.now();
            mergedVault.rev = (existingVault.rev || 0) + 1;
          }

          const clientDeviceId =
            typeof body.clientDeviceId === 'string' ? body.clientDeviceId.slice(0, 128) : '';
          if (clientDeviceId) mergedVault.lastWriter = clientDeviceId;

          const mergedVaultStr = JSON.stringify(mergedVault);
          if (mergedVaultStr.length > MAX_SYNC_PAYLOAD_BYTES) {
            return jsonResponse(
              { error: 'Vault exceeds the maximum sync size. Remove large ink drawings or export a local backup.' },
              413,
              corsHeaders
            );
          }

          await writeVault(env, storageKey, mergedVaultStr);

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
    return handleRequest(request, env);
  }
};
