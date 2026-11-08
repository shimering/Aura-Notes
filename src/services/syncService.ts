import { get, set } from 'idb-keyval';
import { Note } from '../types/note';
import { AppSettings, DEFAULT_SETTINGS, SyncVaultPayload } from '../types/settings';

const SETTINGS_KEY = 'aura_app_settings';
const DELETED_NOTES_KEY = 'aura_deleted_note_ids';
const DEVICE_ID_KEY = 'aura_client_device_id';

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
 * Record a deleted note ID for tombstone tracking
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
    if (hasIndexedDB()) {
      await set(DELETED_NOTES_KEY, deleted);
    } else {
      memoryStorage[DELETED_NOTES_KEY] = deleted;
    }
  } catch (err) {
    console.warn('Failed to record deleted note id:', err);
  }
}

/**
 * Retrieves the record of deleted note IDs and their deletion timestamps
 */
export async function getDeletedNoteTombstones(): Promise<Record<string, number>> {
  try {
    if (hasIndexedDB()) {
      return (await get<Record<string, number>>(DELETED_NOTES_KEY)) || {};
    }
    return memoryStorage[DELETED_NOTES_KEY] || {};
  } catch {
    return {};
  }
}

/**
 * Generates an easy-to-type, memorable random Sync Vault Key
 * e.g. "aura-sync-k7p9-2m4w"
 */
export function generateRandomVaultKey(): string {
  const chars = '23456789abcdefghjkmnpqrstuvwxyz';
  const seg1 = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const seg2 = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `aura-sync-${seg1}-${seg2}`;
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

  const cleanKey = encodeURIComponent(vaultKey.trim());
  const deviceId = await getClientDeviceId();
  const tombstones = await getDeletedNoteTombstones();
  const deletedIds = Object.keys(tombstones);

  const payload: SyncVaultPayload = {
    vaultKey: cleanKey,
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

  const response = await fetch(`/api/sync/vault/${cleanKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Sync failed (${response.status}): ${errorText || 'Unable to sync with vault'}`);
  }

  const result = await response.json();
  const remoteNotes: Note[] = Array.isArray(result.notes) ? result.notes : [];
  const remoteSettings: Partial<AppSettings> = result.settings || {};

  // Merge notes and settings
  const mergedNotes = mergeNotes(localNotes, remoteNotes, tombstones);
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
