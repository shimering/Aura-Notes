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
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const inkCanvasRef = useRef<InkCanvasRef>(null);
  const saveTimeoutRef = useRef<any>(null);
  const syncTimeoutRef = useRef<any>(null);

  // Capture beforeinstallprompt for PWA home screen install
  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Sync execution helper
  const executeSync = useCallback(async (
    vaultKey: string,
    currentNotes: Note[],
    currentSettings: AppSettings
  ) => {
    if (!vaultKey || isSyncing) return;
    setIsSyncing(true);
    setSyncError(null);
    try {
      const res = await syncVaultWithCloud(vaultKey, currentNotes, currentSettings);
      setNotes(res.notes);
      await saveAllNotes(res.notes);
      setSettings(res.settings);

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
      setIsSyncing(false);
    }
  }, [isSyncing]);

  // Initialize and load notes + settings from local IndexedDB
  useEffect(() => {
    async function loadData() {
      try {
        // 1. Load settings
        const loadedSettings = await getSettings();
        setSettings(loadedSettings);

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
          // Clean URL without reload
          window.history.replaceState({}, '', window.location.pathname);
        }

        // 3. Load notes
        const loadedNotes = await getAllNotes();
        setNotes(loadedNotes);

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
  }, []);

  // Auto-sync on window focus or returning to tab (mirror changes from other devices)
  useEffect(() => {
    const handleFocus = () => {
      if (document.visibilityState === 'visible' && settings.syncVaultKey && settings.autoSyncEnabled && !isSyncing) {
        executeSync(settings.syncVaultKey, notes, settings);
      }
    };
    window.addEventListener('visibilitychange', handleFocus);
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('visibilitychange', handleFocus);
      window.removeEventListener('focus', handleFocus);
    };
  }, [settings.syncVaultKey, settings.autoSyncEnabled, isSyncing, notes, settings, executeSync]);

  const activeNote = notes.find((n) => n.id === activeNoteId) || null;

  // Auto-save & background sync debouncer
  const scheduleSave = useCallback((noteToSave: Note) => {
    setIsSaving(true);
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await saveNote(noteToSave);

        // Background auto-sync to cloud vault
        if (settings.syncVaultKey && settings.autoSyncEnabled) {
          if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
          syncTimeoutRef.current = setTimeout(() => {
            executeSync(settings.syncVaultKey, notes, settings);
          }, 1500);
        }
      } catch (err) {
        console.error('Failed to auto-save note:', err);
      } finally {
        setIsSaving(false);
      }
    }, 400);
  }, [notes, settings, executeSync]);

  // Update Note Title
  const handleUpdateTitle = (title: string) => {
    if (!activeNote) return;
    const updated = { ...activeNote, title };
    setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
    scheduleSave(updated);
  };

  // Update Note Text Content
  const handleUpdateContent = (content: string) => {
    if (!activeNote) return;
    const updated = { ...activeNote, content };
    setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
    scheduleSave(updated);
  };

  // Update Stylus Ink Strokes
  const handleUpdateStrokes = (strokes: Stroke[]) => {
    if (!activeNote) return;
    const updated = { ...activeNote, inkStrokes: strokes };
    setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
    scheduleSave(updated);
  };

  // Create New Note
  const handleCreateNote = async () => {
    const newNote: Note = {
      id: `note-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      title: 'Untitled Note',
      content: '',
      inkStrokes: [],
      tags: [],
      color: '#3b82f6',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const updatedNotes = [newNote, ...notes];
    setNotes(updatedNotes);
    setActiveNoteIdState(newNote.id);
    await setActiveNoteId(newNote.id);
    await saveNote(newNote);

    if (settings.syncVaultKey && settings.autoSyncEnabled) {
      executeSync(settings.syncVaultKey, updatedNotes, settings);
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
    const remaining = notes.filter((n) => n.id !== id);
    setNotes(remaining);

    if (activeNoteId === id) {
      const nextId = remaining.length > 0 ? remaining[0].id : null;
      setActiveNoteIdState(nextId);
      if (nextId) await setActiveNoteId(nextId);
    }

    if (settings.syncVaultKey && settings.autoSyncEnabled) {
      executeSync(settings.syncVaultKey, remaining, settings);
    }
  };

  // Toggle Pin Note
  const handleTogglePin = (id: string) => {
    const target = notes.find((n) => n.id === id);
    if (!target) return;
    const updated = { ...target, pinned: !target.pinned };
    setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
    scheduleSave(updated);
  };

  // Update View Mode with settings persistence
  const handleChangeViewMode = async (mode: ViewMode) => {
    setViewMode(mode);
    const updated = await saveSettings({ viewMode: mode });
    setSettings(updated);
  };

  // Update Settings
  const handleUpdateSettings = async (updates: Partial<AppSettings>) => {
    const updated = await saveSettings(updates);
    setSettings(updated);

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
    await executeSync(vaultKey, notes, updatedSettings);
  };

  // Import backup vault
  const handleImportVault = async (importedNotes: Note[], importedSettings?: Partial<AppSettings>) => {
    const merged = [...importedNotes, ...notes.filter((n) => !importedNotes.some((inN) => inN.id === n.id))];
    setNotes(merged);
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
    const updatedNote = {
      ...activeNote,
      content: updatedContent,
      inkStrokes: updatedStrokes
    };

    setNotes((prev) => prev.map((n) => (n.id === updatedNote.id ? updatedNote : n)));
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
      />

      {/* Main Content Workspace */}
      <main className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative transition-all duration-300">
        <Header
          note={activeNote}
          onUpdateTitle={handleUpdateTitle}
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
                  strokes={activeNote.inkStrokes || []}
                  onChangeStrokes={handleUpdateStrokes}
                  onScribbleToText={() => setIsScribbleModalOpen(true)}
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
              onClick={handleCreateNote}
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
    </div>
  );
}
