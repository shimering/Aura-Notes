import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Note, Stroke } from './types/note';
import { AppSettings, DEFAULT_SETTINGS } from './types/settings';
import { 
  getAllNotes, 
  saveNote, 
  saveAllNotes,
  deleteNote, 
  getActiveNoteId, 
  setActiveNoteId 
} from './services/storage';
import { 
  getSettings, 
  saveSettings, 
  syncVaultWithCloud 
} from './services/syncService';
import { Header, ViewMode } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { TextEditor } from './components/TextEditor';
import { InkCanvas, InkCanvasRef } from './components/InkCanvas';
import { ScribbleRecognitionModal } from './components/ScribbleRecognitionModal';
import { InstallModal } from './components/InstallModal';
import { SyncModal } from './components/SyncModal';
import { SettingsModal } from './components/SettingsModal';
import { getNoteTemplate } from './utils/templates';

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteIdState] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return window.innerWidth >= 1024 ? 'both' : 'text';
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const [isScribbleModalOpen, setIsScribbleModalOpen] = useState(false);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const inkCanvasRef = useRef<InkCanvasRef>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<any>(null);
  const syncTimeoutRef = useRef<any>(null);

  // Mutable refs to prevent stale closure race conditions
  const notesRef = useRef<Note[]>(notes);
  notesRef.current = notes;

  const settingsRef = useRef<AppSettings>(settings);
  settingsRef.current = settings;

  const activeNoteIdRef = useRef<string | null>(activeNoteId);
  activeNoteIdRef.current = activeNoteId;

  const isSyncingRef = useRef<boolean>(false);
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
    if (!vaultKey || isSyncingRef.current) return;
    isSyncingRef.current = true;
    setIsSyncing(true);
    setSyncError(null);

    try {
      const res = await syncVaultWithCloud(vaultKey, currentNotes, currentSettings);
      
      // Safety guard against overwriting local in-flight edits:
      const latestLocal = notesRef.current;
      const mergedResult = res.notes.map((remoteNote) => {
        const local = latestLocal.find((n) => n.id === remoteNote.id);
        if (!local) return remoteNote;

        // If local note was edited more recently, keep local
        if ((local.updatedAt || 0) > (remoteNote.updatedAt || 0)) {
          return local;
        }

        // If equal timestamps, never let an empty/shorter stroke list erase drawn strokes
        if ((local.updatedAt || 0) === (remoteNote.updatedAt || 0)) {
          const localStrokes = local.inkStrokes?.length || 0;
          const remoteStrokes = remoteNote.inkStrokes?.length || 0;
          if (localStrokes > remoteStrokes) return local;
        }

        // If user was actively drawing or editing in the last 2.5 seconds, protect active local note
        if (Date.now() - (lastLocalEditTimeRef.current || 0) < 2500 && local.id === activeNoteIdRef.current) {
          return local;
        }

        return remoteNote;
      });

      // Keep any new local notes created while sync was in flight
      for (const local of latestLocal) {
        if (!mergedResult.some((n) => n.id === local.id)) {
          mergedResult.unshift(local);
        }
      }

      setNotes(mergedResult);
      notesRef.current = mergedResult;
      await saveAllNotes(mergedResult);

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
        setViewMode(res.settings.viewMode);
      }
      return res;
    } catch (err: any) {
      console.warn('Sync failed:', err);
      setSyncError(err.message || 'Unable to sync with cloud vault');
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, []);

  // Initialize and load notes + settings from local IndexedDB
  useEffect(() => {
    async function loadData() {
      try {
        // 1. Load settings
        const loadedSettings = await getSettings();
        setSettings(loadedSettings);
        settingsRef.current = loadedSettings;

        // Apply theme from settings
        if (loadedSettings.theme === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }

        if (loadedSettings.viewMode) {
          setViewMode(loadedSettings.viewMode);
        }

        // 2. Check URL for 1-click sync link (?sync=KEY)
        let activeVaultKey = loadedSettings.syncVaultKey;
        const searchParams = new URLSearchParams(window.location.search);
        const querySyncKey = searchParams.get('sync');
        if (querySyncKey && querySyncKey.trim()) {
          activeVaultKey = querySyncKey.trim();
          const updated = await saveSettings({ syncVaultKey: activeVaultKey });
          setSettings(updated);
          settingsRef.current = updated;
          // Clean URL query param without reload
          window.history.replaceState({}, '', window.location.pathname);
        }

        // 3. Load notes
        const loadedNotes = await getAllNotes();
        setNotes(loadedNotes);
        notesRef.current = loadedNotes;

        const lastActiveId = await getActiveNoteId();
        if (lastActiveId && loadedNotes.some((n) => n.id === lastActiveId)) {
          setActiveNoteIdState(lastActiveId);
        } else if (loadedNotes.length > 0) {
          setActiveNoteIdState(loadedNotes[0].id);
        }

        // 4. Initial cloud sync if vault is configured
        if (activeVaultKey && loadedSettings.autoSyncEnabled) {
          executeSync(activeVaultKey, loadedNotes, loadedSettings);
        }
      } catch (err) {
        console.error('Error loading notes & settings:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [executeSync]);

  // Sync when switching back to tab
  useEffect(() => {
    const handleVisibility = () => {
      if (
        document.visibilityState === 'visible' &&
        settingsRef.current.syncVaultKey &&
        settingsRef.current.autoSyncEnabled &&
        !isSyncingRef.current &&
        Date.now() - (lastLocalEditTimeRef.current || 0) > 2500
      ) {
        executeSync(settingsRef.current.syncVaultKey, notesRef.current, settingsRef.current);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [executeSync]);

  const activeNote = notes.find((n) => n.id === activeNoteId) || null;
  const allTags = Array.from(new Set(notes.flatMap((n) => n.tags || []))).sort((a, b) =>
    a.localeCompare(b)
  );

  // Auto-save & background sync debouncer
  const scheduleSave = useCallback((noteToSave: Note) => {
    setIsSaving(true);
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Fast local save (150ms)
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await saveNote(noteToSave);
      } catch (err) {
        console.error('Failed to auto-save note:', err);
      } finally {
        setIsSaving(false);
      }
    }, 150);

    // Fast background cloud push (600ms) with latest notesRef
    if (settingsRef.current.syncVaultKey && settingsRef.current.autoSyncEnabled) {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = setTimeout(() => {
        executeSync(settingsRef.current.syncVaultKey, notesRef.current, settingsRef.current);
      }, 600);
    }
  }, [executeSync]);

  // Update Note Title with timestamp
  const handleUpdateTitle = (title: string) => {
    if (!activeNote) return;
    const now = Date.now();
    lastLocalEditTimeRef.current = now;
    const updated = { ...activeNote, title, updatedAt: now };
    setNotes((prev) => {
      const next = prev.map((n) => (n.id === updated.id ? updated : n));
      notesRef.current = next;
      return next;
    });
    scheduleSave(updated);
  };

  // Update Note Text Content with timestamp
  const handleUpdateContent = (content: string) => {
    if (!activeNote) return;
    const now = Date.now();
    lastLocalEditTimeRef.current = now;
    const updated = { ...activeNote, content, updatedAt: now };
    setNotes((prev) => {
      const next = prev.map((n) => (n.id === updated.id ? updated : n));
      notesRef.current = next;
      return next;
    });
    scheduleSave(updated);
  };

  // Update Stylus Ink Strokes with timestamp
  const handleUpdateStrokes = (strokes: Stroke[]) => {
    if (!activeNote) return;
    const now = Date.now();
    lastLocalEditTimeRef.current = now;
    const updated: Note = { 
      ...activeNote, 
      inkStrokes: strokes, 
      updatedAt: now 
    };
    setNotes((prev) => {
      const next = prev.map((n) => (n.id === updated.id ? updated : n));
      notesRef.current = next;
      return next;
    });
    scheduleSave(updated);
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
    setNotes(updatedNotes);
    notesRef.current = updatedNotes;
    setActiveNoteIdState(newNote.id);
    await setActiveNoteId(newNote.id);
    await saveNote(newNote);

    if (settingsRef.current.syncVaultKey && settingsRef.current.autoSyncEnabled) {
      executeSync(settingsRef.current.syncVaultKey, updatedNotes, settingsRef.current);
    }
  };

  // Select Note
  const handleSelectNote = async (id: string) => {
    setActiveNoteIdState(id);
    await setActiveNoteId(id);
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  };

  // Delete Note
  const handleDeleteNote = async (id: string) => {
    await deleteNote(id);
    const remaining = notesRef.current.filter((n) => n.id !== id);
    setNotes(remaining);
    notesRef.current = remaining;

    if (activeNoteId === id) {
      const nextId = remaining.length > 0 ? remaining[0].id : null;
      setActiveNoteIdState(nextId);
      if (nextId) await setActiveNoteId(nextId);
    }

    if (settingsRef.current.syncVaultKey && settingsRef.current.autoSyncEnabled) {
      executeSync(settingsRef.current.syncVaultKey, remaining, settingsRef.current);
    }
  };

  // Toggle Pin Note
  const handleTogglePin = (id: string) => {
    const target = notes.find((n) => n.id === id);
    if (!target) return;
    const now = Date.now();
    lastLocalEditTimeRef.current = now;
    const updated = { ...target, pinned: !target.pinned, updatedAt: now };
    setNotes((prev) => {
      const next = prev.map((n) => (n.id === id ? updated : n));
      notesRef.current = next;
      return next;
    });
    scheduleSave(updated);
  };

  // Update Note Tags
  const handleUpdateTags = (tags: string[]) => {
    if (!activeNote) return;
    const now = Date.now();
    lastLocalEditTimeRef.current = now;
    const updated = { ...activeNote, tags, updatedAt: now };
    setNotes((prev) => {
      const next = prev.map((n) => (n.id === updated.id ? updated : n));
      notesRef.current = next;
      return next;
    });
    scheduleSave(updated);
  };

  // Update View Mode with settings persistence
  const handleChangeViewMode = async (mode: ViewMode) => {
    setViewMode(mode);
    const updated = await saveSettings({ viewMode: mode });
    setSettings(updated);
    settingsRef.current = updated;
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
    if (updates.viewMode) {
      setViewMode(updates.viewMode);
    }
    if (typeof updates.isSidebarOpen === 'boolean') {
      setIsSidebarOpen(updates.isSidebarOpen);
    }
  };

  // Manual Trigger Sync from Sync Modal or Header
  const handleManualSync = async (vaultKey: string) => {
    const updatedSettings = await saveSettings({ syncVaultKey: vaultKey });
    setSettings(updatedSettings);
    settingsRef.current = updatedSettings;
    await executeSync(vaultKey, notesRef.current, updatedSettings);
  };

  // Import backup vault
  const handleImportVault = async (importedNotes: Note[], importedSettings?: Partial<AppSettings>) => {
    const current = notesRef.current;
    const merged = [...importedNotes, ...current.filter((n) => !importedNotes.some((inN) => inN.id === n.id))];
    setNotes(merged);
    notesRef.current = merged;
    await saveAllNotes(merged);

    if (importedSettings) {
      await handleUpdateSettings(importedSettings);
    }
  };

  // Insert Recognized Handwriting into Note
  const handleInsertScribbleText = (recognizedText: string, clearStrokes: boolean) => {
    if (!activeNote) return;

    const formattedInsert = `<p>${recognizedText.replace(/\n/g, '<br/>')}</p>`;
    const updatedContent = activeNote.content 
      ? `${activeNote.content}<br/>${formattedInsert}` 
      : formattedInsert;

    const updatedStrokes = clearStrokes ? [] : activeNote.inkStrokes;
    const now = Date.now();
    lastLocalEditTimeRef.current = now;
    const updatedNote = {
      ...activeNote,
      content: updatedContent,
      inkStrokes: updatedStrokes,
      updatedAt: now
    };

    setNotes((prev) => {
      const next = prev.map((n) => (n.id === updatedNote.id ? updatedNote : n));
      notesRef.current = next;
      return next;
    });
    scheduleSave(updatedNote);
  };

  // Export Note as Markdown file
  const handleExport = () => {
    if (!activeNote) return;

    const div = document.createElement('div');
    div.innerHTML = activeNote.content;
    const plainText = div.innerText || '';

    const mdContent = `# ${activeNote.title || 'Untitled Note'}\n\n${plainText}\n\n---\n*Created with Aura Notes Studio on ${new Date(activeNote.createdAt).toLocaleString()}*`;
    const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(activeNote.title || 'note').replace(/[^a-zA-Z0-9_-]/g, '_')}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const focusSearch = () => {
      setIsSidebarOpen(true);
      saveSettings({ isSidebarOpen: true });
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
          setIsSaving(true);
          saveNote(current).finally(() => setIsSaving(false));
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
    // handleCreateNote is stable enough for a shortcut: it only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <div className="h-full w-full flex bg-canvas-light dark:bg-canvas-dark text-ink-light dark:text-ink-dark overflow-hidden font-sans select-none">
      {/* Collapsible Note Sidebar */}
      <Sidebar
        notes={notes}
        activeNoteId={activeNoteId}
        onSelectNote={handleSelectNote}
        onCreateNote={handleCreateNote}
        onDeleteNote={handleDeleteNote}
        onTogglePin={handleTogglePin}
        isOpen={isSidebarOpen}
        onToggleOpen={() => {
          const next = !isSidebarOpen;
          setIsSidebarOpen(next);
          saveSettings({ isSidebarOpen: next });
        }}
        onDownloadApp={() => setIsInstallModalOpen(true)}
        onOpenSync={() => setIsSyncModalOpen(true)}
        syncVaultKey={settings.syncVaultKey}
        searchInputRef={searchInputRef}
      />

      {/* Main Content Workspace */}
      <main className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative transition-all duration-300">
        <Header
          note={activeNote}
          onUpdateTitle={handleUpdateTitle}
          onUpdateTags={handleUpdateTags}
          allTags={allTags}
          onToggleSidebar={() => {
            const next = !isSidebarOpen;
            setIsSidebarOpen(next);
            saveSettings({ isSidebarOpen: next });
          }}
          isSidebarOpen={isSidebarOpen}
          viewMode={viewMode}
          onChangeViewMode={handleChangeViewMode}
          isSaving={isSaving}
          onExport={handleExport}
          onOpenInstall={() => setIsInstallModalOpen(true)}
          onOpenSync={() => setIsSyncModalOpen(true)}
          onOpenSettings={() => setIsSettingsModalOpen(true)}
          isSyncing={isSyncing}
          syncVaultKey={settings.syncVaultKey}
        />

        {activeNote ? (
          <div className="flex-1 flex flex-col lg:flex-row h-full min-h-0 overflow-hidden relative transition-all duration-300">
            {/* Keyboard Rich Text Editor View */}
            {(viewMode === 'text' || viewMode === 'both') && (
              <div 
                className={`h-full min-h-0 overflow-hidden flex flex-col transition-all duration-300 ${
                  viewMode === 'both' ? 'flex-1 lg:border-r border-surface-subtle-light dark:border-surface-subtle-dark' : 'flex-1'
                }`}
              >
                <TextEditor
                  note={activeNote}
                  onChangeContent={handleUpdateContent}
                />
              </div>
            )}

            {/* Stylus Ink Drawing Canvas (S Pen & Apple Pencil) */}
            {(viewMode === 'ink' || viewMode === 'both') && (
              <div className="flex-1 h-full min-h-0 overflow-hidden flex flex-col relative transition-all duration-300">
                <InkCanvas
                  ref={inkCanvasRef}
                  noteId={activeNote.id}
                  strokes={activeNote.inkStrokes || []}
                  onChangeStrokes={handleUpdateStrokes}
                  onScribbleToText={() => setIsScribbleModalOpen(true)}
                  defaultTool={settings.defaultPenTool}
                  defaultColor={settings.defaultPenColor}
                  defaultWidth={settings.defaultPenWidth}
                  defaultStylusOnly={settings.stylusOnly}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-ink-muted-light dark:text-ink-muted-dark">
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

      {/* Scribble to Text Recognition Modal */}
      {activeNote && (
        <ScribbleRecognitionModal
          isOpen={isScribbleModalOpen}
          onClose={() => setIsScribbleModalOpen(false)}
          strokes={activeNote.inkStrokes || []}
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
