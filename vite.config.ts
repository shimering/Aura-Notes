import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Vite dev middleware to emulate Cloudflare Worker Sync API during local testing
function devSyncApiPlugin(): Plugin {
  const devVaultStore = new Map<string, any>();

  return {
    name: 'dev-sync-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith('/api/sync/vault/')) {
          const vaultKey = decodeURIComponent(req.url.replace('/api/sync/vault/', '').split('?')[0]).trim();

          res.setHeader('Content-Type', 'application/json');
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

          if (req.method === 'GET') {
            const vault = devVaultStore.get(vaultKey) || { notes: [], settings: {}, updatedAt: 0 };
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
                const existing = devVaultStore.get(vaultKey) || { notes: [], settings: {}, deletedNoteIds: [] };

                // Merge deleted
                const allDeleted = Array.from(new Set([...(existing.deletedNoteIds || []), ...(body.deletedNoteIds || [])]));
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

                const mergedVault = {
                  vaultKey,
                  notes: Array.from(noteMap.values()),
                  settings: { ...(existing.settings || {}), ...(body.settings || {}) },
                  deletedNoteIds: allDeleted,
                  updatedAt: Date.now()
                };

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
        }
        next();
      });
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig({
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
