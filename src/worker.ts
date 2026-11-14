import { createFreebuffAuth, type FreebuffAuth } from '@freebuff/auth';

interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
  AURA_SYNC_KV?: {
    get: (key: string) => Promise<string | null>;
    put: (key: string, value: string) => Promise<void>;
  };
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
  getUser: (request: Request) => Promise<{ sub: string; email?: string; name?: string; picture?: string } | null>;
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

/**
 * Signed-in account API. Only used by the UI to show who is signed in; the
 * vault sync routes stay anonymous until per-user storage lands.
 */
async function handleAccountApi(request: Request, env: Env): Promise<Response> {
  const runtime = getAuthRuntime(env);
  if (!runtime) {
    return jsonResponse(
      { error: 'Sign in with Freebuff is not configured yet', code: 'auth_not_configured' },
      503
    );
  }

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const user = await runtime.getUser(request);
  if (!user) {
    return jsonResponse({ error: 'Sign in required' }, 401, { 'Cache-Control': 'private, no-store' });
  }

  return jsonResponse({ user }, 200, { 'Cache-Control': 'private, no-store' });
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/account') {
      return handleAccountApi(request, env);
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
