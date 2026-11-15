import { getClientDeviceId, isValidVaultKey } from './syncService';

/**
 * Push channel for cross-device sync.
 *
 * The client keeps exactly one hanging request open. The Worker (or the Vite
 * dev middleware) holds it until another device writes, then answers with the
 * new revision, which is all this module needs to trigger a normal sync pass.
 * Idle devices send one request every ~18s instead of polling on a timer, and
 * a change on any device reaches the others within about a second.
 */

const REQUEST_TIMEOUT_MS = 30_000;
const OFFLINE_RETRY_MS = 3_000;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 15_000;

export interface WatchOptions {
  signal: AbortSignal;
  onChanged: () => void;
}

interface WatchReply {
  changed?: boolean;
  version?: string | number;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish);
  });
}

async function runWatchLoop(
  buildUrl: (version: string | null) => string,
  options: WatchOptions
): Promise<void> {
  const { signal, onChanged } = options;
  let version: string | null = null;
  let backoff = RETRY_BASE_MS;

  while (!signal.aborted) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await sleep(OFFLINE_RETRY_MS, signal);
      continue;
    }

    const controller = new AbortController();
    const relayAbort = () => controller.abort();
    signal.addEventListener('abort', relayAbort);
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let reply: WatchReply | null = null;
    try {
      const response = await fetch(buildUrl(version), {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });

      if (signal.aborted) return;

      // No push channel on this deployment (for example plain `vite dev` for
      // account sync): stop instead of retrying forever. Visibility-based sync
      // still covers those cases.
      if ([401, 404, 405, 501].includes(response.status)) return;
      if (!response.ok) throw new Error(`Push channel responded ${response.status}`);

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('json')) return;

      reply = (await response.json()) as WatchReply;
      backoff = RETRY_BASE_MS;
    } catch {
      if (signal.aborted) return;
      await sleep(backoff, signal);
      backoff = Math.min(backoff * 2, RETRY_MAX_MS);
      continue;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', relayAbort);
    }

    if (!reply) continue;

    const nextVersion: string | null =
      reply.version === undefined ? version : String(reply.version);
    // The first reply only establishes the current revision.
    if (version === null) {
      version = nextVersion ?? '0';
      continue;
    }
    version = nextVersion ?? version;
    if (reply.changed) onChanged();
  }
}

/** Watches the anonymous vault key of this device. */
export async function watchVaultChanges(
  vaultKey: string,
  options: WatchOptions
): Promise<void> {
  const key = (vaultKey || '').trim();
  if (!isValidVaultKey(key)) return;

  const deviceId = await getClientDeviceId();
  const encodedKey = encodeURIComponent(key);

  return runWatchLoop((version) => {
    const params = new URLSearchParams();
    if (version !== null) params.set('v', version);
    params.set('device', deviceId);
    return `/api/sync/vault/${encodedKey}/watch?${params.toString()}`;
  }, options);
}

/** Watches the signed-in account's notes. */
export function watchAccountChanges(options: WatchOptions): Promise<void> {
  return runWatchLoop((version) => {
    if (version === null) return '/api/notes/watch';
    return `/api/notes/watch?v=${encodeURIComponent(version)}`;
  }, options);
}
