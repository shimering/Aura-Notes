interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
  AURA_SYNC_KV?: {
    get: (key: string) => Promise<string | null>;
    put: (key: string, value: string) => Promise<void>;
  };
}

// In-memory fallback if KV is not configured on Cloudflare
const memoryVaultStore = new Map<string, string>();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

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
        return new Response(JSON.stringify({ error: 'Vault key is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
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
          return new Response(JSON.stringify({ notes: [], settings: {}, updatedAt: 0 }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
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

          // Merge deleted IDs
          const allDeleted = Array.from(new Set([...(existingVault.deletedNoteIds || []), ...incomingDeleted]));
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
                const inStrokes = inNote.inkStrokes?.length || 0;
                const exStrokes = existing.inkStrokes?.length || 0;
                if (inStrokes >= exStrokes) {
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
          if (env.AURA_SYNC_KV) {
            await env.AURA_SYNC_KV.put(storageKey, mergedVaultStr);
          } else {
            memoryVaultStore.set(storageKey, mergedVaultStr);
          }

          return new Response(mergedVaultStr, {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (err: any) {
          return new Response(JSON.stringify({ error: err.message || 'Sync failed' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    return env.ASSETS.fetch(request);
  }
};
