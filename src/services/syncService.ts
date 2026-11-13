import { get, set } from 'idb-keyval';
import { Note } from '../types/note';
import { AppSettings, DEFAULT_SETTINGS, SyncVaultPayload } from '../types/settings';

const SETTINGS_KEY = 'aura_app_settings';
const DELETED_NOTES_KEY = 'aura_deleted_note_ids';
const DEVICE_ID_KEY = 'aura_client_device_id';

// Tombstones only need to survive long enough for every device to observe a
// deletion. Pruning keeps sync payloads and KV values from growing forever.
const TOMBSTONE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_SYNC_PAYLOAD_BYTES = 20 * 1024 * 1024;

// In-memory fallback
const memoryStorage: Record<string, any> = {};

function hasIndexedDB(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

/**
 * Generates or retrieves a persistent unique client device ID
 */
export async function getClientDeviceId(): Promise<string> {
  try {
    let id: string | undefined;
    if (hasIndexedDB()) {
      id = await get<string>(DEVICE_ID_KEY);
    } else {
      id = memoryStorage[DEVICE_ID_KEY];
    }
    if (!id) {
      id = `dev-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`;
      if (hasIndexedDB()) {
        await set(DEVICE_ID_KEY, id);
      } else {
        memoryStorage[DEVICE_ID_KEY] = id;
      }
    }
    return id;
  } catch {
    return `dev-${Date.now().toString(36)}`;
  }
}

/**
 * Loads user settings from storage
 */
export async function getSettings(): Promise<AppSettings> {
  try {
    let stored: Partial<AppSettings> | undefined;
    if (hasIndexedDB()) {
      stored = await get<Partial<AppSettings>>(SETTINGS_KEY);
    } else {
      stored = memoryStorage[SETTINGS_KEY];
    }
    return {
      ...DEFAULT_SETTINGS,
      ...(stored || {})
    };
  } catch (err) {
    console.error('Failed to load settings:', err);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Saves user settings to storage
 */
export async function saveSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
  try {
    const current = await getSettings();
    const updated: AppSettings = {
      ...current,
      ...updates,
      updatedAt: Date.now()
    };
    if (hasIndexedDB()) {
      await set(SETTINGS_KEY, updated);
    } else {
      memoryStorage[SETTINGS_KEY] = updated;
    }
    return updated;
  } catch (err) {
    console.error('Failed to save settings:', err);
    throw err;
  }
}

/**
 * Record a deleted note ID for tombstone tracking.
 */
export async function recordDeletedNoteId(id: string): Promise<void> {
  try {
    let deleted: Record<string, number> = {};
    if (hasIndexedDB()) {
      deleted = (await get<Record<string, number>>(DELETED_NOTES_KEY)) || {};
    } else {
      deleted = memoryStorage[DELETED_NOTES_KEY] || {};
    }
    deleted[id] = Date.now();
    const pruned = pruneTombstones(deleted);
    if (hasIndexedDB()) {
      await set(DELETED_NOTES_KEY, pruned);
    } else {
      memoryStorage[DELETED_NOTES_KEY] = pruned;
    }
  } catch (err) {
    console.warn('Failed to record deleted note id:', err);
  }
}

/**
 * Drops tombstones older than the retention window.
 */
export function pruneTombstones(
  tombstones: Record<string, number>,
  now: number = Date.now()
): Record<string, number> {
  const cutoff = now - TOMBSTONE_MAX_AGE_MS;
  const pruned: Record<string, number> = {};
  for (const [id, deletedAt] of Object.entries(tombstones)) {
    if (typeof deletedAt === 'number' && deletedAt >= cutoff) {
      pruned[id] = deletedAt;
    }
  }
  return pruned;
}

/**
 * Retrieves the record of deleted note IDs and their deletion timestamps.
 * Expired tombstones are pruned and persisted lazily.
 */
export async function getDeletedNoteTombstones(): Promise<Record<string, number>> {
  try {
    let deleted: Record<string, number>;
    if (hasIndexedDB()) {
      deleted = (await get<Record<string, number>>(DELETED_NOTES_KEY)) || {};
    } else {
      deleted = memoryStorage[DELETED_NOTES_KEY] || {};
    }

    const pruned = pruneTombstones(deleted);
    if (Object.keys(pruned).length !== Object.keys(deleted).length) {
      if (hasIndexedDB()) {
        await set(DELETED_NOTES_KEY, pruned);
      } else {
        memoryStorage[DELETED_NOTES_KEY] = pruned;
      }
    }
    return pruned;
  } catch {
    return {};
  }
}

/**
 * Persists the tombstone map (already pruned by the caller).
 */
export async function saveDeletedNoteTombstones(tombstones: Record<string, number>): Promise<void> {
  const pruned = pruneTombstones(tombstones);
  if (hasIndexedDB()) {
    await set(DELETED_NOTES_KEY, pruned);
  } else {
    memoryStorage[DELETED_NOTES_KEY] = pruned;
  }
}

/**
 * Generates an easy-to-type, memorable random Sync Vault Key
 * e.g. "aura-sync-k7p9-2m4w-9x3r"
 */
export function generateRandomVaultKey(): string {
  const chars = '23456789abcdefghjkmnpqrstuvwxyz';
  const segment = () =>
    Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `aura-sync-${segment()}-${segment()}-${segment()}`;
}

/**
 * Vault keys are the only shared secret, so constrain them to a sane,
 * URL-safe shape and a minimum length.
 */
export function isValidVaultKey(key: string): boolean {
  const trimmed = (key || '').trim();
  return trimmed.length >= 8 && trimmed.length <= 128 && /^[A-Za-z0-9_-]+$/.test(trimmed);
}

/**
 * Merges local and remote notes using Last-Write-Wins (LWW)
 * and deleted note tombstone filtering.
 */
export function mergeNotes(
  localNotes: Note[],
  remoteNotes: Note[],
  deletedTombstones: Record<string, number> = {}
): Note[] {
  const noteMap = new Map<string, Note>();

  // Helper to test if a note is deleted
  const isDeleted = (note: Note) => {
    const deletedTime = deletedTombstones[note.id];
    return deletedTime !== undefined && deletedTime >= (note.updatedAt || 0);
  };

  // Add local notes
  for (const n of localNotes) {
    if (!isDeleted(n)) {
      noteMap.set(n.id, n);
    }
  }

  // Merge remote notes
  for (const rn of remoteNotes) {
    if (isDeleted(rn)) continue;

    const existing = noteMap.get(rn.id);
    if (!existing) {
      noteMap.set(rn.id, rn);
    } else {
      const rnTime = rn.updatedAt || 0;
      const exTime = existing.updatedAt || 0;

      if (rnTime > exTime) {
        noteMap.set(rn.id, rn);
      } else if (rnTime === exTime) {
        // Equal timestamps: never allow an empty-stroke or shorter note to overwrite drawn strokes!
        const rnStrokes = rn.inkStrokes?.length || 0;
        const exStrokes = existing.inkStrokes?.length || 0;
        if (rnStrokes > exStrokes) {
          noteMap.set(rn.id, rn);
        } else if (rnStrokes === exStrokes) {
          if ((rn.content?.length || 0) >= (existing.content?.length || 0)) {
            noteMap.set(rn.id, rn);
          }
        }
      }
    }
  }

  return Array.from(noteMap.values()).sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

/**
 * Merges local settings with remote settings
 */
export function mergeSettings(local: AppSettings, remote: Partial<AppSettings>): AppSettings {
  if (!remote || Object.keys(remote).length === 0) return local;

  const remoteTime = remote.updatedAt || 0;
  const localTime = local.updatedAt || 0;

  if (remoteTime > localTime) {
    return {
      ...local,
      ...remote,
      // Always retain the active vault key locally
      syncVaultKey: local.syncVaultKey || remote.syncVaultKey || '',
      updatedAt: remoteTime
    };
  }

  return local;
}

/**
 * Synchronizes notes and settings with the cloud vault.
 * Connects to `/api/sync/vault/:vaultKey`
 */
export async function syncVaultWithCloud(
  vaultKey: string,
  localNotes: Note[],
  localSettings: AppSettings
): Promise<{ notes: Note[]; settings: AppSettings; syncedAt: number }> {
  if (!vaultKey || !vaultKey.trim()) {
    throw new Error('Please provide a valid Sync Vault Key');
  }
  if (!isValidVaultKey(vaultKey)) {
    throw new Error('Sync Vault Key must be 8–128 characters using letters, numbers, dashes, or underscores.');
  }

  const cleanKey = encodeURIComponent(vaultKey.trim());
  const deviceId = await getClientDeviceId();
  const tombstones = await getDeletedNoteTombstones();
  const deletedIds = Object.keys(tombstones);

  const payload: SyncVaultPayload = {
    vaultKey: vaultKey.trim(),
    notes: localNotes,
    settings: {
      theme: localSettings.theme,
      viewMode: localSettings.viewMode,
      isSidebarOpen: localSettings.isSidebarOpen,
      stylusOnly: localSettings.stylusOnly,
      defaultPenTool: localSettings.defaultPenTool,
      defaultPenColor: localSettings.defaultPenColor,
      defaultPenWidth: localSettings.defaultPenWidth,
      updatedAt: localSettings.updatedAt
    },
    deletedNoteIds: deletedIds,
    updatedAt: Date.now(),
    clientDeviceId: deviceId
  };

  const serializedPayload = JSON.stringify(payload);
  if (serializedPayload.length > MAX_SYNC_PAYLOAD_BYTES) {
    throw new Error(
      `This vault is too large to sync (${Math.round(serializedPayload.length / 1024 / 1024)} MB). ` +
      'Try exporting a backup and removing very large ink drawings.'
    );
  }

  const response = await fetch(`/api/sync/vault/${cleanKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: serializedPayload
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Sync failed (${response.status}): ${errorText || 'Unable to sync with vault'}`);
  }

  const result = await response.json();
  const remoteNotes: Note[] = Array.isArray(result.notes) ? result.notes : [];
  const remoteSettings: Partial<AppSettings> = result.settings || {};
  const remoteDeletedIds: string[] = Array.isArray(result.deletedNoteIds)
    ? result.deletedNoteIds
    : [];

  // Deletions made on other devices must remove local copies too. The server
  // does not store per-tombstone timestamps, so treat them as "now".
  const combinedTombstones: Record<string, number> = { ...tombstones };
  for (const id of remoteDeletedIds) {
    if (!combinedTombstones[id]) {
      combinedTombstones[id] = Date.now();
    }
  }
  if (remoteDeletedIds.length > 0) {
    await saveDeletedNoteTombstones(combinedTombstones);
  }

  // Merge notes and settings
  const mergedNotes = mergeNotes(localNotes, remoteNotes, combinedTombstones);
  const mergedSettings = mergeSettings(localSettings, remoteSettings);

  const syncedAt = Date.now();
  mergedSettings.lastSyncedAt = syncedAt;

  // Persist updated settings
  await saveSettings({
    ...mergedSettings,
    syncVaultKey: vaultKey.trim(),
    lastSyncedAt: syncedAt
  });

  return {
    notes: mergedNotes,
    settings: mergedSettings,
    syncedAt
  };
}

/**
 * Export full notes and settings archive to JSON
 */
export function exportVaultToJson(notes: Note[], settings: AppSettings): void {
  const exportData = {
    app: 'Aura Notes Studio',
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    settings,
    notes
  };

  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const dateStr = new Date().toISOString().split('T')[0];
  link.download = `aura-notes-backup-${dateStr}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Import notes and settings from a JSON file
 */
export function parseVaultJson(jsonString: string): { notes: Note[]; settings?: Partial<AppSettings> } {
  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed || !Array.isArray(parsed.notes)) {
      throw new Error('Invalid backup file format: missing notes array');
    }
    return {
      notes: parsed.notes,
      settings: parsed.settings || undefined
    };
  } catch (err: any) {
    throw new Error(`Failed to parse backup file: ${err.message}`);
  }
}
