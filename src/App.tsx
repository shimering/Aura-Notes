import React, { useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { ChevronLeft, PanelLeft } from 'lucide-react';
import { Note, NotePageData, Stroke, InkBackground, PenTool, PageLayout, NoteArrow } from './types/note';
import { AppSettings, DEFAULT_SETTINGS } from './types/settings';
import { 
  getAllNotes, 
  saveNote, 
  deleteNote, 
  getActiveNoteId, 
  setActiveNoteId,
  setStorageNamespace,
  getStorageNamespace,
  applyNoteChanges,
} from './services/storage';
import { 
  getSettings, 
  saveSettings, 
  syncVaultWithCloud 
} from './services/syncService';
import {
  fetchAuthConfig, fetchAuthSession, AuthUser, readOfflineAccountId, rememberOfflineAccount
} from './services/authService';
import { AccountSyncError, syncAccountNotes } from './services/accountSyncService';
import { watchAccountChanges, watchVaultChanges } from './services/liveSyncService';
import { Sidebar } from './components/Sidebar';
import { TextEditor, TextEditorRef } from './components/TextEditor';
import { InkCanvas, InkCanvasRef } from './components/InkCanvas';
import { NotePageBar, PhonePagePicker } from './components/NotePageBar';
import { ScribbleRecognitionModal } from './components/ScribbleRecognitionModal';
import { InstallModal } from './components/InstallModal';
import { SyncModal } from './components/SyncModal';
import { SettingsModal } from './components/SettingsModal';
import { getNoteTemplate } from './utils/templates';
import { plainTextToNoteHtml, sanitizeNoteHtml } from './utils/noteHtml';
import { notePages, removeNotePage, updateNotePage } from './utils/notePages';
import { useKeyboardViewport } from './utils/useKeyboardViewport';

function mergeSyncResult(
  before: Note[], current: Note[], synced: Note[], deleted: ReadonlySet<string>
): Note[] {
  const started = new Map(before.map((note) => [note.id, note]));
  const latest = new Map(current.map((note) => [note.id, note]));
  const merged = new Map(synced.map((note) => [note.id, note]));
  for (const id of started.keys()) {
    if (!latest.has(id)) merged.delete(id);
  }
  for (const [id, note] of latest) {
    if (started.get(id) !== note) merged.set(id, note);
  }
  for (const id of deleted) merged.delete(id);
  return [...merged.values()];
}

export default function App() {
  const keyboardOpen = useKeyboardViewport();
  const [workspaceWidth, setWorkspaceWidth] = useState(() => window.innerWidth);
  const isPhone = workspaceWidth < 640;
  const isDockedWorkspace = workspaceWidth >= 1024;
  const [phoneNotesOpen, setPhoneNotesOpen] = useState(true);
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteIdState] = useState<string | null>(null);
  const [pageSelection, setPageSelection] = useState<{ noteId: string; pageId: string }>();
  const [editingBox, setEditingBox] = useState<HTMLElement | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  
  // Mirror the canvas tool so the text sheet can enable the caret in Text mode.
  const [surfaceTool, setSurfaceTool] = useState<PenTool>('text');
  const [isDockedSidebarOpen, setIsDockedSidebarOpen] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const isSidebarOpen = isDockedWorkspace ? isDockedSidebarOpen : isDrawerOpen;
  const setIsSidebarOpen = isDockedWorkspace ? setIsDockedSidebarOpen : setIsDrawerOpen;
  const [isScribbleModalOpen, setIsScribbleModalOpen] = useState(false);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [account, setAccount] = useState<AuthUser | null>(null);
  const [offlineChoice, setOfflineChoice] = useState<string | null>(null);
  const [offlineAccountId, setOfflineAccountId] = useState<string | null>(null);
  // False when the auth routes are absent (plain `vite dev`) or the Worker has
  // no auth secret: the account panel then hides itself instead of offering a
  // form that cannot work.
  const [authAvailable, setAuthAvailable] = useState(true);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  const inkCanvasRef = useRef<InkCanvasRef>(null);
  const textEditorRef = useRef<TextEditorRef>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const noteTitleRef = useRef<HTMLInputElement>(null);
  const notesMenuRef = useRef<HTMLButtonElement>(null);
  const pendingSaves = useRef(new Map<string, Promise<void>>());
  const failedSaves = useRef(new Map<string, Note>());
  const deletingNotes = useRef(new Set<string>());
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Mutable refs to prevent stale closure race conditions
  const notesRef = useRef<Note[]>(notes);

  const settingsRef = useRef<AppSettings>(settings);
  settingsRef.current = settings;

  const activeNoteIdRef = useRef<string | null>(activeNoteId);
  activeNoteIdRef.current = activeNoteId;

  useEffect(() => {
    const update = () => setWorkspaceWidth(window.innerWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Signed-in account user, mirrored into a ref for use inside callbacks.
  const accountRef = useRef<AuthUser | null>(null);
  accountRef.current = account;

  const isSyncingRef = useRef<boolean>(false);
  const syncRequestedWhileBusy = useRef(false);
  const retrySyncRef = useRef<() => void>(() => {});
  const lastLocalEditTimeRef = useRef<number>(0);

  // Capture beforeinstallprompt for PWA home screen install
  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Sync execution helper with active local edit protection
  const executeSync = useCallback(async (
    vaultKey: string,
    currentNotes: Note[],
    currentSettings: AppSettings
  ) => {
    if (!vaultKey || getStorageNamespace() || deletingNotes.current.size > 0) return;
    if (isSyncingRef.current) {
      syncRequestedWhileBusy.current = true;
      return;
    }
    isSyncingRef.current = true;
    setIsSyncing(true);
    setSyncError(null);

    try {
      const res = await syncVaultWithCloud(vaultKey, currentNotes, currentSettings);
      
      const deleted = new Set([...res.deletedIds, ...deletingNotes.current]);
      const latest = notesRef.current;
      const mergedResult = mergeSyncResult(currentNotes, latest, res.notes, deleted);
      const unchanged = new Set(latest);

      setNotes(mergedResult);
      notesRef.current = mergedResult;
      await applyNoteChanges(mergedResult.filter((note) => !unchanged.has(note)), deleted);

      // If the active note was deleted on another device, fall back gracefully.
      if (!mergedResult.some((n) => n.id === activeNoteIdRef.current)) {
        const nextId = mergedResult.length > 0 ? mergedResult[0].id : null;
        setActiveNoteIdState(nextId);
        activeNoteIdRef.current = nextId;
        if (nextId) await setActiveNoteId(nextId);
      }

      setSettings(res.settings);
      settingsRef.current = res.settings;

      // Apply synced theme & view mode if enabled
      if (res.settings.syncThemeAndLayout) {
        if (res.settings.theme === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      }
      return res;
    } catch (err: any) {
      console.warn('Sync failed:', err);
      setSyncError(err.message || 'Unable to sync with cloud vault');
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
      if (syncRequestedWhileBusy.current) retrySyncRef.current();
    }
  }, []);

  /**
   * Account sync for signed-in visitors: D1 metadata + R2 payloads, scoped to
   * their Better Auth user id by the Worker. Notes from this device's anonymous
   * namespace are never uploaded.
   */
  const executeAccountSync = useCallback(async () => {
    if (!accountRef.current || accountRef.current.id !== getStorageNamespace()
      || deletingNotes.current.size > 0) return;
    if (isSyncingRef.current) {
      syncRequestedWhileBusy.current = true;
      return;
    }
    isSyncingRef.current = true;
    setIsSyncing(true);
    setSyncError(null);
    const before = notesRef.current;

    try {
      await Promise.all(pendingSaves.current.values());
      if (failedSaves.current.size > 0) return;
      const res = await syncAccountNotes();
      const merged = mergeSyncResult(before, notesRef.current, res.notes, deletingNotes.current);

      setNotes(merged);
      notesRef.current = merged;

      if (!merged.some((n) => n.id === activeNoteIdRef.current)) {
        const nextId = merged.length > 0 ? merged[0].id : null;
        setActiveNoteIdState(nextId);
        activeNoteIdRef.current = nextId;
        if (nextId) await setActiveNoteId(nextId);
      }

      if (res.pushed || res.pulled || res.deleted) {
        const updatedSettings = await saveSettings({ lastSyncedAt: res.lastSyncedAt });
        setSettings(updatedSettings);
        settingsRef.current = updatedSettings;
      }

      return res;
    } catch (err: any) {
      console.warn('Account sync failed:', err);
      setSyncError(
        err instanceof AccountSyncError
          ? err.message
          : 'Unable to sync notes with your account. Check your connection.'
      );
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
      if (syncRequestedWhileBusy.current) retrySyncRef.current();
    }
  }, []);

  const runAutoSync = useCallback(() => {
    syncRequestedWhileBusy.current = false;
    const prefs = settingsRef.current;
    if (!prefs.autoSyncEnabled) return;
    if (accountRef.current) {
      void executeAccountSync();
    } else if (!getStorageNamespace() && prefs.syncVaultKey) {
      void executeSync(prefs.syncVaultKey, notesRef.current, prefs);
    }
  }, [executeAccountSync, executeSync]);
  retrySyncRef.current = runAutoSync;

  const openNotebook = useCallback(async (user: AuthUser | null, cachedId?: string) => {
    setStorageNamespace(user?.id ?? cachedId ?? null);
    const loadedSettings = await getSettings();
    const querySyncKey = new URLSearchParams(window.location.search).get('sync')?.trim();
    const prefs = querySyncKey ? await saveSettings({ syncVaultKey: querySyncKey }) : loadedSettings;
    if (querySyncKey) window.history.replaceState({}, '', window.location.pathname);

    const loadedNotes = await getAllNotes();
    const lastActiveId = await getActiveNoteId();
    const nextId = lastActiveId && loadedNotes.some((note) => note.id === lastActiveId)
      ? lastActiveId
      : loadedNotes[0]?.id ?? null;

    document.documentElement.classList.toggle('dark', prefs.theme === 'dark');
    settingsRef.current = prefs;
    notesRef.current = loadedNotes;
    activeNoteIdRef.current = nextId;
    accountRef.current = user;
    setSettings(prefs);
    setIsDockedSidebarOpen(prefs.isSidebarOpen);
    setNotes(loadedNotes);
    setActiveNoteIdState(nextId);
    setAccount(user);
    setOfflineAccountId(cachedId ?? null);
    setOfflineChoice(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      try {
        const [session, authConfig] = await Promise.all([
          fetchAuthSession(),
          fetchAuthConfig()
        ]);
        if (cancelled) return;
        setAuthAvailable(authConfig.available);
        setGoogleEnabled(authConfig.google);
        if (session.status === 'unavailable') {
          const cachedId = readOfflineAccountId();
          if (cachedId) {
            setOfflineChoice(cachedId);
            return;
          }
        } else {
          rememberOfflineAccount(session.status === 'signed-in' ? session.user.id : null);
        }
        await openNotebook(session.status === 'signed-in' ? session.user : null);
      } catch (err) {
        console.error('Error loading notes & settings:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadData();
    return () => { cancelled = true; };
  }, [openNotebook]);

  useEffect(() => {
    if (!isLoading && !offlineChoice && !offlineAccountId) runAutoSync();
  }, [isLoading, offlineChoice, offlineAccountId, runAutoSync]);

  useEffect(() => {
    if (!offlineAccountId) return;
    let cancelled = false;
    let checking = false;
    const recheck = async () => {
      if (checking || navigator.onLine === false) return;
      checking = true;
      const session = await fetchAuthSession();
      checking = false;
      if (cancelled) return;
      if (session.status === 'signed-in' && session.user.id === offlineAccountId) {
        accountRef.current = session.user;
        setAccount(session.user);
        setAuthAvailable(true);
        setOfflineAccountId(null);
      } else if (session.status !== 'unavailable') {
        rememberOfflineAccount(null);
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void recheck();
    };
    window.addEventListener('online', recheck);
    document.addEventListener('visibilitychange', onVisible);
    void recheck();
    return () => {
      cancelled = true;
      window.removeEventListener('online', recheck);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [offlineAccountId]);

  // Sync when switching back to tab
  useEffect(() => {
    const handleVisibility = () => {
      if (
        document.visibilityState === 'visible' &&
        settingsRef.current.autoSyncEnabled &&
        !isSyncingRef.current &&
        Date.now() - (lastLocalEditTimeRef.current || 0) > 2500
      ) {
        runAutoSync();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [runAutoSync]);

  /**
   * Live push channel: the Worker holds one request open per device and answers
   * as soon as another device writes, so nothing is polled while nothing
   * changes. The answer just triggers the normal sync pass.
   */
  useEffect(() => {
    const vaultKey = settings.syncVaultKey;
    const signedIn = !!account;
    if (isLoading || offlineChoice || offlineAccountId || !settings.autoSyncEnabled
      || (!signedIn && !vaultKey)) return;

    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const pullLatest = () => {
      const run = () => {
        // A sync already in flight will see the newest server state anyway.
        if (isSyncingRef.current) {
          if (attempts++ < 15) retryTimer = setTimeout(run, 800);
          return;
        }
        attempts = 0;
        if (accountRef.current) {
          executeAccountSync();
        } else if (settingsRef.current.syncVaultKey) {
          executeSync(settingsRef.current.syncVaultKey, notesRef.current, settingsRef.current);
        }
      };
      run();
    };

    if (signedIn) {
      watchAccountChanges({ signal: controller.signal, onChanged: pullLatest });
    } else {
      watchVaultChanges(vaultKey, { signal: controller.signal, onChanged: pullLatest });
    }

    return () => {
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [account, isLoading, offlineChoice, offlineAccountId, settings.autoSyncEnabled, settings.syncVaultKey, executeSync, executeAccountSync]);

  const activeNote = notes.find((n) => n.id === activeNoteId) || null;
  const pages = activeNote ? notePages(activeNote) : [];
  const pageIndex = Math.max(0, pages.findIndex((page) => pageSelection?.noteId === activeNoteId && page.id === pageSelection.pageId));
  const activePage = pages[pageIndex];
  const surfaceId = activeNote && activePage ? JSON.stringify([activeNote.id, activePage.id]) : '';

  const persistLocalEdit = useCallback((note: Note) => {
    if (deletingNotes.current.has(note.id)) return;
    setIsSaving(true);
    const write = saveNote(note).then(
      () => {
        if (pendingSaves.current.get(note.id) === write) failedSaves.current.delete(note.id);
      },
      (err) => {
        console.error('Failed to auto-save note:', err);
        if (pendingSaves.current.get(note.id) === write) failedSaves.current.set(note.id, note);
      }
    ).finally(() => {
      if (pendingSaves.current.get(note.id) === write) pendingSaves.current.delete(note.id);
      setIsSaving(pendingSaves.current.size > 0);
      setSaveError(failedSaves.current.size > 0);
    });
    pendingSaves.current.set(note.id, write);
    return write;
  }, []);

  const scheduleSave = useCallback((note: Note) => {
    void persistLocalEdit(note);
    clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(runAutoSync, 600);
  }, [persistLocalEdit, runAutoSync]);
  useEffect(() => () => clearTimeout(syncTimeoutRef.current), []);

  /**
   * Applies one edit to the active note from the latest committed state. Two
   * rapid edits (transforming ink and text together) must not each spread a
   * stale `activeNote`, or the second would drop the first one's change.
   */
  const updateActiveNote = useCallback((updater: (note: Note) => Note, id = activeNoteIdRef.current) => {
    if (!id) return;
    const current = notesRef.current.find((note) => note.id === id);
    if (!current) return;

    const nextNote = updater(current);
    if (nextNote === current) return;
    const now = Date.now();
    lastLocalEditTimeRef.current = now;
    const updated = { ...nextNote, updatedAt: Math.max(now, current.updatedAt + 1) };
    const next = notesRef.current.map((note) =>
      note.id === updated.id ? updated : note
    );
    // Update the ref before React renders so a second edit in the same event
    // (for example ink + text in one selection transform) reads this change.
    notesRef.current = next;
    setNotes(next);
    scheduleSave(updated);
  }, [scheduleSave]);

  const updateActivePage = (update: Partial<NotePageData>) => {
    if (!activePage) return;
    updateActiveNote((current) => current.id === activeNoteId ? updateNotePage(current, activePage.id, update) : current);
  };

  const openPage = (pageId: string) => {
    if (!activeNote) return;
    textEditorRef.current?.finishEditing();
    setPageSelection({ noteId: activeNote.id, pageId });
  };

  const addPage = () => {
    if (!activePage || !activeNote) return;
    const page = { id: crypto.randomUUID(), content: '', inkStrokes: [],
      pageLayout: activePage.pageLayout, inkBackground: activePage.inkBackground,
      pageColor: activePage.pageColor };
    updateActiveNote((current) => ({ ...current, extraPages: [...notePages(current).slice(1), page] }));
    openPage(page.id);
  };

  const deletePage = () => {
    if (!activePage || pages.length < 2) return;
    if (!window.confirm(`Delete page ${pageIndex + 1} and its contents?`)) return;
    updateActiveNote((current) => removeNotePage(current, activePage.id));
    openPage((pages[pageIndex + 1] ?? pages[pageIndex - 1]).id);
  };

  // Update Note Title with timestamp
  const handleUpdateTitle = (title: string) => {
    updateActiveNote((current) => ({ ...current, title }));
  };

  // Update Note Text Content with timestamp
  const handleUpdateContent = (content: string) => {
    updateActivePage({ content });
  };

  // Update Stylus Ink Strokes with timestamp
  const handleUpdateStrokes = (strokes: Stroke[]) => {
    updateActivePage({ inkStrokes: strokes });
  };

  // Map-chart arrows: kept with the page so they sync and reload with it.
  const handleUpdateArrows = (arrows: NoteArrow[]) => {
    updateActivePage({ arrows });
  };

  // Create New Note (optionally from a template)
  const handleCreateNote = async (templateId?: string) => {
    const now = Date.now();
    lastLocalEditTimeRef.current = now;
    const template = getNoteTemplate(templateId);
    const newNote: Note = {
      id: `note-${now}-${Math.random().toString(36).substr(2, 6)}`,
      title: template.title || 'Untitled Note',
      content: template.content,
      inkStrokes: [],
      tags: [...template.tags],
      color: template.color,
      createdAt: now,
      updatedAt: now
    };

    const updatedNotes = [newNote, ...notesRef.current];
    const openNewNote = () => {
      setNotes(updatedNotes);
      notesRef.current = updatedNotes;
      activeNoteIdRef.current = newNote.id;
      setActiveNoteIdState(newNote.id);
      if (isPhone) setPhoneNotesOpen(false);
      else if (!isDockedWorkspace) setIsDrawerOpen(false);
    };
    if (!templateId) {
      // Touch browsers require focus during the tap to open the keyboard.
      flushSync(openNewNote);
      noteTitleRef.current?.focus();
      noteTitleRef.current?.select();
    } else {
      openNewNote();
    }
    await persistLocalEdit(newNote);
    if (activeNoteIdRef.current === newNote.id) await setActiveNoteId(newNote.id);
    runAutoSync();
  };

  // Select Note
  const handleSelectNote = async (id: string) => {
    if (id !== activeNoteIdRef.current) setPageSelection(undefined);
    activeNoteIdRef.current = id;
    setActiveNoteIdState(id);
    if (isPhone) {
      setPhoneNotesOpen(false);
    } else if (!isDockedWorkspace) {
      setIsDrawerOpen(false);
      window.requestAnimationFrame(() => notesMenuRef.current?.focus({ preventScroll: true }));
    }
    await setActiveNoteId(id);
  };

  // Delete Note
  const handleDeleteNote = async (id: string) => {
    if (deletingNotes.current.has(id)) return;
    const removed = notesRef.current.find((note) => note.id === id);
    if (!removed) return;
    deletingNotes.current.add(id);
    const remaining = notesRef.current.filter((n) => n.id !== id);
    setNotes(remaining);
    notesRef.current = remaining;

    if (activeNoteIdRef.current === id) {
      const nextId = remaining[0]?.id ?? null;
      activeNoteIdRef.current = nextId;
      setActiveNoteIdState(nextId);
      if (nextId) void setActiveNoteId(nextId);
    }

    try {
      await pendingSaves.current.get(id);
      await deleteNote(id);
      failedSaves.current.delete(id);
      setSaveError(failedSaves.current.size > 0);
    } catch (err) {
      console.error('Failed to delete note:', err);
      notesRef.current = [removed, ...notesRef.current];
      setNotes(notesRef.current);
      setSaveError(true);
    } finally {
      deletingNotes.current.delete(id);
    }
    runAutoSync();
  };

  // Toggle Pin Note
  const handleTogglePin = (id: string) => {
    const target = notesRef.current.find((n) => n.id === id);
    if (!target) return;
    const now = Date.now();
    lastLocalEditTimeRef.current = now;
    const updated = { ...target, pinned: !target.pinned, updatedAt: Math.max(now, target.updatedAt + 1) };
    notesRef.current = notesRef.current.map((note) => note.id === id ? updated : note);
    setNotes(notesRef.current);
    scheduleSave(updated);
  };

  // Update Note Tags
  const handleUpdateTags = (tags: string[], noteId?: string) => {
    updateActiveNote((current) => ({ ...current, tags }), noteId);
  };

  // Update Ink Page Background
  const handleUpdateBackground = (background: InkBackground) => {
    updateActivePage({ inkBackground: background });
  };

  // Tint the note surface: the A4 paper or the endless canvas
  const handleUpdatePageColor = (pageColor?: string) => {
    updateActivePage({ pageColor });
  };

  // Rotate the note's A4 sheet between vertical and horizontal
  const handleUpdatePageLayout = (pageLayout: PageLayout) => {
    updateActivePage({ pageLayout });
  };

  // Update Settings
  const handleUpdateSettings = async (updates: Partial<AppSettings>) => {
    const updated = await saveSettings(updates);
    setSettings(updated);
    settingsRef.current = updated;

    if (updates.theme) {
      if (updates.theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
    if (typeof updates.isSidebarOpen === 'boolean') {
      setIsDockedSidebarOpen(updates.isSidebarOpen);
    }
  };

  // Manual sync from the sync dialog
  const handleManualSync = async (vaultKey: string) => {
    if (accountRef.current) {
      // Account sync replaces vault-key sync while signed in.
      await executeAccountSync();
      return;
    }
    if (getStorageNamespace()) return;
    const updatedSettings = await saveSettings({ syncVaultKey: vaultKey });
    setSettings(updatedSettings);
    settingsRef.current = updatedSettings;
    await executeSync(vaultKey, notesRef.current, updatedSettings);
  };

  const reloadNotebook = async () => {
    await Promise.all(pendingSaves.current.values());
    if (failedSaves.current.size === 0) window.location.reload();
  };

  const handleAccountSignedOut = async () => {
    rememberOfflineAccount(null);
    accountRef.current = null;
    setAccount(null);
    setOfflineAccountId(getStorageNamespace());
    await reloadNotebook();
  };

  // Import backup vault
  const handleImportVault = async (importedNotes: Note[], importedSettings?: Partial<AppSettings>) => {
    const before = notesRef.current;
    const importedIds = new Set(importedNotes.map((note) => note.id));
    const merged = [...importedNotes, ...before.filter((note) => !importedIds.has(note.id))];
    await applyNoteChanges(importedNotes);
    notesRef.current = mergeSyncResult(before, notesRef.current, merged, deletingNotes.current);
    setNotes(notesRef.current);

    if (importedSettings) {
      await handleUpdateSettings(importedSettings);
    }
  };

  // Insert Recognized Handwriting into Note
  const handleInsertScribbleText = (recognizedText: string, clearStrokes: boolean) => {
    const paragraph = `<p>${plainTextToNoteHtml(recognizedText)}</p>`;
    textEditorRef.current?.appendTextBox(paragraph);
    if (activePage) updateActivePage({
      ...(clearStrokes ? { inkStrokes: [] } : {}),
      recognizedText: [activePage.recognizedText?.trim(), recognizedText].filter(Boolean).join('\n')
    });
  };

  // Export Note as Markdown file
  const handleExport = (noteId = activeNoteIdRef.current) => {
    const note = notesRef.current.find(({ id }) => id === noteId);
    if (!note) return;

    const pages = notePages(note);
    const div = document.createElement('div');
    const plainText = pages.map((page, index) => {
      div.innerHTML = sanitizeNoteHtml(page.content);
      const content = div.innerText || '';
      return pages.length > 1 ? `## Page ${index + 1}\n\n${content}` : content;
    }).join('\n\n');

    const mdContent = `# ${note.title || 'Untitled Note'}\n\n${plainText}\n\n---\n*Created with Aura Notes Studio on ${new Date(note.createdAt).toLocaleString()}*`;
    const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(note.title || 'note').replace(/[^a-zA-Z0-9_-]/g, '_')}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Global keyboard shortcuts
  useEffect(() => {
    if (isLoading || offlineChoice) return;
    const focusSearch = () => {
      if (isPhone) {
        textEditorRef.current?.finishEditing();
        setPhoneNotesOpen(true);
      } else {
        if (isDockedWorkspace) {
          setIsDockedSidebarOpen(true);
          void saveSettings({ isSidebarOpen: true });
        } else setIsDrawerOpen(true);
      }
      window.setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 50);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (e.key === 'Escape') {
        setIsScribbleModalOpen(false);
        setIsInstallModalOpen(false);
        setIsSyncModalOpen(false);
        setIsSettingsModalOpen(false);
        return;
      }

      const target = e.target as HTMLElement | null;
      const isEditingText =
        !!target &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA');

      if (!mod) {
        // "/" focuses search, unless the user is already typing.
        if (e.key === '/' && !isEditingText) {
          e.preventDefault();
          focusSearch();
        }
        return;
      }

      const key = e.key.toLowerCase();

      if ((key === 'k' || key === 'f') && !e.shiftKey) {
        // Ctrl+K is a reliable alias because mobile browsers reserve Ctrl+F.
        e.preventDefault();
        focusSearch();
        return;
      }

      if (key === 'n' && !e.shiftKey && !isEditingText) {
        e.preventDefault();
        handleCreateNote();
        return;
      }

      if (key === 's') {
        e.preventDefault();
        const current = notesRef.current.find((n) => n.id === activeNoteIdRef.current);
        if (current) {
          scheduleSave(current);
        }
        return;
      }

      if (isEditingText) return;

      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          inkCanvasRef.current?.redo();
        } else {
          inkCanvasRef.current?.undo();
        }
      } else if (key === 'y') {
        e.preventDefault();
        inkCanvasRef.current?.redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, offlineChoice, scheduleSave, isPhone, isDockedWorkspace]);

  const chooseNotebook = async (cachedId?: string) => {
    setIsLoading(true);
    try {
      await openNotebook(null, cachedId);
    } catch (err) {
      console.error('Error opening the notebook:', err);
      setSaveError(true);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-canvas-light dark:bg-canvas-dark text-ink-muted-light dark:text-ink-muted-dark">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-violet-600 to-pink-500 animate-pulse flex items-center justify-center text-white" />
          <span className="text-sm font-medium tracking-tight">Opening Aura Notes Studio...</span>
        </div>
      </div>
    );
  }

  if (offlineChoice) {
    return (
      <main className="h-full grid place-content-center gap-4 px-6 bg-canvas-light dark:bg-canvas-dark text-ink-light dark:text-ink-dark">
        <h1 className="text-lg font-semibold">Account verification unavailable</h1>
        <p className="max-w-sm text-sm">If this is your device, you can open the account notes saved here. Sync resumes when Aura Notes verifies your account.</p>
        <button type="button" className="rounded-lg bg-violet-600 px-4 py-2 text-white" onClick={() => void chooseNotebook(offlineChoice)}>
          Open cached account notes
        </button>
        <button type="button" className="rounded-lg border border-current px-4 py-2" onClick={() => void chooseNotebook()}>
          Open device notes
        </button>
      </main>
    );
  }

  const toggleSidebar = () => {
    const next = !isSidebarOpen;
    setIsSidebarOpen(next);
    if (isDockedWorkspace) void saveSettings({ isSidebarOpen: next });
    else if (!next) window.requestAnimationFrame(() => notesMenuRef.current?.focus({ preventScroll: true }));
  };
  const notesMenuButton = (
    <button ref={notesMenuRef} type="button" className="workspace-notes-toggle"
      title={isSidebarOpen ? 'Hide notes list' : 'Show notes list'}
      aria-label="Notes list" aria-controls="notes-sidebar" aria-expanded={isSidebarOpen}
      onMouseDown={(event) => event.preventDefault()} onClick={toggleSidebar}>
      <PanelLeft size={18} aria-hidden="true" /> Notes
    </button>
  );
  const showPhoneNotes = isPhone && (phoneNotesOpen || !activeNote);
  const showTabletDrawer = !isPhone && !isDockedWorkspace && isSidebarOpen;
  const pageControls = { pages, pageIndex, onSelect: openPage, onAdd: addPage, onDelete: deletePage };

  return (
    <div className="h-full w-full flex flex-col bg-canvas-light dark:bg-canvas-dark text-ink-light dark:text-ink-dark overflow-hidden font-sans select-none">
        {offlineAccountId && (
          <div role="status" className="flex flex-wrap items-center gap-x-3 px-4 py-2 text-sm bg-amber-100 text-amber-950">
            <span>Showing cached account notes. Sync is paused until your account is verified.</span>
            <button type="button" className="underline" onClick={() => void reloadNotebook()}>Check account</button>
          </div>
        )}
        {saveError && (
          <div role="alert" className="flex flex-wrap items-center gap-x-3 px-4 py-2 text-sm bg-rose-100 text-rose-950">
            <span>A change could not be saved on this device.</span>
            {failedSaves.current.size > 0 && (
              <button type="button" className="underline" onClick={() => {
                for (const note of failedSaves.current.values()) scheduleSave(note);
              }}>Retry saving</button>
            )}
          </div>
        )}

      <div className="relative flex flex-1 min-h-0">
        <Sidebar
          notes={notes}
          activeNoteId={activeNoteId}
          onSelectNote={handleSelectNote}
          onCreateNote={handleCreateNote}
          onDeleteNote={handleDeleteNote}
          onTogglePin={handleTogglePin}
          isPhone={isPhone}
          isDrawer={!isPhone && !isDockedWorkspace}
          isOpen={isPhone ? showPhoneNotes : isSidebarOpen}
          onToggleOpen={toggleSidebar}
          onUpdateTags={handleUpdateTags}
          onExport={handleExport}
          isSaving={isSaving}
          isSyncing={isSyncing}
          onOpenSettings={() => setIsSettingsModalOpen(true)}
          onDownloadApp={() => setIsInstallModalOpen(true)}
          onOpenSync={() => setIsSyncModalOpen(true)}
          syncVaultKey={settings.syncVaultKey}
          accountSyncActive={!!account}
          searchInputRef={searchInputRef}
        />

        <main inert={showPhoneNotes || showTabletDrawer} className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {activeNote && activePage ? (
          <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden relative transition-all duration-300">
              <header className={isPhone ? 'phone-editor-header' : 'workspace-editor-header'}>
                {isPhone ? <button type="button" className="phone-editor-action" aria-controls="notes-sidebar" onClick={() => {
                  textEditorRef.current?.finishEditing();
                  setPhoneNotesOpen(true);
                }}><ChevronLeft size={19} /> Notes</button> : notesMenuButton}
                <input ref={noteTitleRef} type="text" aria-label="Note title" value={activeNote.title}
                  placeholder="Untitled Note" enterKeyHint="done" onChange={(event) => handleUpdateTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur();
                  }} />
                {isPhone ? <PhonePagePicker key={activeNote.id} {...pageControls} /> : <NotePageBar {...pageControls} />}
              </header>
            {/* One page: typed text with ink above and behind it. */}
            <InkCanvas
              ref={inkCanvasRef}
              isPhone={isPhone}
              keyboardOpen={keyboardOpen}
              editingBox={editingBox}
              noteId={surfaceId}
              strokes={activePage.inkStrokes || []}
              onChangeStrokes={handleUpdateStrokes}
              arrows={activePage.arrows || []}
              onChangeArrows={handleUpdateArrows}
              onScribbleToText={() => setIsScribbleModalOpen(true)}
              onRequestTextFocus={() => textEditorRef.current?.focusEditor()}
              onToolChange={setSurfaceTool}
              textLayer={
                <TextEditor
                  ref={textEditorRef}
                  note={{ ...activePage, id: surfaceId }}
                  onChangeContent={handleUpdateContent}
                  onEditingChange={setEditingBox}
                  getNoteSize={(content) => {
                    const current = notesRef.current.find((note) => note.id === activeNote.id) ?? activeNote;
                    return new Blob([JSON.stringify(updateNotePage(current, activePage.id, { content }))]).size;
                  }}
                  embedded
                  editable={surfaceTool === 'text'}
                />
              }
              textEditor={textEditorRef}
              defaultTool={settings.defaultPenTool}
              defaultColor={settings.defaultPenColor}
              defaultWidth={settings.defaultPenWidth}
              defaultEraserWidth={settings.defaultEraserWidth}
              defaultEraserMode={settings.defaultEraserMode}
              defaultStylusOnly={settings.stylusOnly}
              spenHoldEraseMs={settings.spenHoldEraseMs}
              spenDoublePressOpensMenu={settings.spenDoublePressOpensMenu}
              background={activePage.inkBackground}
              onChangeBackground={handleUpdateBackground}
              pageColor={activePage.pageColor}
              onPageColorChange={handleUpdatePageColor}
              pageLayout={activePage.pageLayout}
              onChangePageLayout={handleUpdatePageLayout}
              textLayout={activePage.textLayout}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-ink-muted-light dark:text-ink-muted-dark">
            <div className="absolute left-2 top-2">{notesMenuButton}</div>
            <h2 className="text-xl font-semibold mb-2">No Note Selected</h2>
            <p className="text-sm max-w-sm mb-6">
              Create a new note or select an existing one from the sidebar to begin typing or drawing.
            </p>
            <button
              onClick={() => handleCreateNote()}
              className="px-5 py-2.5 rounded-2xl bg-violet-600 hover:bg-violet-700 text-white font-medium shadow-md transition active:scale-95"
            >
              Create New Note
            </button>
          </div>
        )}
        </main>
      </div>

      {/* Scribble to Text Recognition Modal */}
      {activePage && (
        <ScribbleRecognitionModal
          isOpen={isScribbleModalOpen}
          onClose={() => setIsScribbleModalOpen(false)}
          strokes={activePage.inkStrokes || []}
          canvasElement={inkCanvasRef.current?.getCanvasElement() || null}
          onInsertText={handleInsertScribbleText}
        />
      )}

      {/* PWA Download to Home Screen Modal */}
      <InstallModal
        isOpen={isInstallModalOpen}
        onClose={() => setIsInstallModalOpen(false)}
        installPrompt={installPrompt}
        onInstallSuccess={() => {
          setInstallPrompt(null);
        }}
      />

      {/* Cross-Device Sync Modal */}
      <SyncModal
        isOpen={isSyncModalOpen}
        onClose={() => setIsSyncModalOpen(false)}
        notes={notes}
        settings={settings}
        onSync={handleManualSync}
        onImportVault={handleImportVault}
        onUpdateSettings={handleUpdateSettings}
        isSyncing={isSyncing}
        syncError={syncError}
        account={authAvailable ? account : undefined}
        googleEnabled={googleEnabled}
        onAccountSignedIn={reloadNotebook}
        onAccountSignedOut={handleAccountSignedOut}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        onOpenSync={() => setIsSyncModalOpen(true)}
      />
    </div>
  );
}
