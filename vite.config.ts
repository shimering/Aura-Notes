import { defineConfig, Plugin, ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Vite dev middleware emulating the Worker's vault sync + push channel so
// cross-device behaviour can be exercised locally without a Cloudflare account.
function devSyncApiPlugin(): Plugin {
  const devVaultStore = new Map<string, any>();
  const WATCH_HOLD_MS = 18000;
  const WATCH_POLL_MS = 750;

  const vaultFingerprint = (vault: any) => {
    const notes = (vault?.notes || [])
      .map((note: any) => `${String(note?.id ?? '')}@${Number(note?.updatedAt) || 0}`)
      .sort();
    const deleted = [...(vault?.deletedNoteIds || [])].map(String).sort();
    const settings = Object.keys(vault?.settings || {})
      .sort()
      .map((key) => [key, vault.settings[key]]);
    return JSON.stringify([notes, deleted, settings]);
  };

  return {
    name: 'dev-sync-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/sync/vault/')) {
          next();
          return;
        }

        const requestUrl = new URL(req.url, 'http://localhost');
        const watchMatch = requestUrl.pathname.match(/^\/api\/sync\/vault\/([^/]+)\/watch\/?$/);
        const vaultKey = (
          watchMatch
            ? decodeURIComponent(watchMatch[1])
            : decodeURIComponent(requestUrl.pathname.replace('/api/sync/vault/', ''))
        ).trim();

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.end();
          return;
        }

        if (!/^[A-Za-z0-9_-]{8,128}$/.test(vaultKey)) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Invalid vault key' }));
          return;
        }

        if (watchMatch) {
          const since = requestUrl.searchParams.get('v');
          const deviceId = requestUrl.searchParams.get('device') || '';
          const currentRev = () => devVaultStore.get(vaultKey)?.rev || 0;
          const lastWriter = () => devVaultStore.get(vaultKey)?.lastWriter || '';

          if (since === null || since.trim() === '') {
            res.statusCode = 200;
            res.end(JSON.stringify({ changed: false, version: currentRev() }));
            return;
          }

          const deadline = Date.now() + WATCH_HOLD_MS;
          let finished = false;
          const timer = setInterval(() => {
            if (finished) return;
            const rev = currentRev();
            const mine = lastWriter() === deviceId;
            if (String(rev) !== String(since)) {
              finished = true;
              clearInterval(timer);
              res.statusCode = 200;
              res.end(JSON.stringify({ changed: !mine, version: rev }));
            } else if (Date.now() > deadline) {
              finished = true;
              clearInterval(timer);
              res.statusCode = 200;
              res.end(JSON.stringify({ changed: false, version: rev }));
            }
          }, WATCH_POLL_MS);
          req.on('close', () => {
            finished = true;
            clearInterval(timer);
          });
          return;
        }

        if (req.method === 'GET') {
          const vault = devVaultStore.get(vaultKey) || {
            notes: [],
            settings: {},
            deletedNoteIds: [],
            updatedAt: 0,
            rev: 0
          };
          res.statusCode = 200;
          res.end(JSON.stringify(vault));
          return;
        }

        if (req.method === 'POST') {
          let bodyStr = '';
          req.on('data', (chunk) => {
            bodyStr += chunk;
          });
          req.on('end', () => {
            try {
              if (bodyStr.length > 20 * 1024 * 1024) {
                res.statusCode = 413;
                res.end(JSON.stringify({ error: 'Sync payload too large' }));
                return;
              }
              const body = JSON.parse(bodyStr);
              const existing = devVaultStore.get(vaultKey) || {
                notes: [],
                settings: {},
                deletedNoteIds: [],
                updatedAt: 0,
                rev: 0
              };

              // Merge deleted
              const allDeleted = Array.from(
                new Set([...(existing.deletedNoteIds || []), ...(body.deletedNoteIds || [])])
              );
              const deletedSet = new Set(allDeleted);

              const noteMap = new Map();
              for (const n of existing.notes || []) {
                if (!deletedSet.has(n.id)) noteMap.set(n.id, n);
              }
              for (const n of body.notes || []) {
                if (deletedSet.has(n.id)) continue;
                const prev = noteMap.get(n.id);
                if (!prev) {
                  noteMap.set(n.id, n);
                } else {
                  const inTime = n.updatedAt || 0;
                  const prevTime = prev.updatedAt || 0;
                  if (inTime > prevTime) {
                    noteMap.set(n.id, n);
                  } else if (inTime === prevTime) {
                    const inStrokes = n.inkStrokes?.length || 0;
                    const prevStrokes = prev.inkStrokes?.length || 0;
                    if (inStrokes > prevStrokes) {
                      noteMap.set(n.id, n);
                    } else if (
                      inStrokes === prevStrokes &&
                      (n.content?.length || 0) > (prev.content?.length || 0)
                    ) {
                      noteMap.set(n.id, n);
                    }
                  }
                }
              }

              const mergedVault: any = {
                vaultKey,
                notes: Array.from(noteMap.values()),
                settings: { ...(existing.settings || {}), ...(body.settings || {}) },
                deletedNoteIds: allDeleted,
                updatedAt: existing.updatedAt || 0,
                rev: existing.rev || 0,
                lastWriter: existing.lastWriter || ''
              };

              if (vaultFingerprint(mergedVault) !== vaultFingerprint(existing)) {
                mergedVault.updatedAt = Date.now();
                mergedVault.rev = (existing.rev || 0) + 1;
              }

              if (typeof body.clientDeviceId === 'string' && body.clientDeviceId) {
                mergedVault.lastWriter = body.clientDeviceId.slice(0, 128);
              }

              devVaultStore.set(vaultKey, mergedVault);
              res.statusCode = 200;
              res.end(JSON.stringify(mergedVault));
            } catch (e: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message }));
            }
          });
          return;
        }

        next();
      });
    }
  };
}

/**
 * Sends a request to the local Worker while keeping the browser's Host, so
 * Better Auth derives its cookie, callback and Google redirect URLs from the
 * page the user is on (localhost:5173) instead of the proxy's target.
 */
function workerProxy(): ProxyOptions {
  return {
    target: 'http://127.0.0.1:8787',
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq, req) => {
        if (req.headers.host) proxyReq.setHeader('host', req.headers.host);
      });
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    // This server emulates only the vault API above; accounts need the real
    // Worker. Forward its routes to `npm run dev:worker` (localhost:8787) so
    // sign-in works in the dev preview too.
    proxy: {
      '/api/auth-config': workerProxy(),
      '/api/auth': workerProxy(),
      '/api/notes': workerProxy()
    }
  },
  plugins: [
    devSyncApiPlugin(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icon.svg', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        name: 'Aura Notes - Stylus & Scribble Note Studio',
        short_name: 'Aura Notes',
        description: 'Elegant note app with S Pen, Apple Pencil stylus support and scribble-to-text recognition',
        theme_color: '#ffffff',
        background_color: '#fbfbfa',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        categories: ['productivity', 'utilities'],
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Never answer auth or API routes from the offline shell: sign-in, OAuth
        // callbacks and session checks must reach the Worker.
        navigateFallbackDenylist: [/^\/auth\//, /^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cdn-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              }
            }
          }
        ]
      }
    })
  ]
});
