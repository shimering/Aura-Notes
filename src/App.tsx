import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Note, Stroke } from './types/note';
import { 
  getAllNotes, 
  saveNote, 
  deleteNote, 
  getActiveNoteId, 
  setActiveNoteId 
} from './services/storage';
import { Header, ViewMode } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { TextEditor } from './components/TextEditor';
import { InkCanvas, InkCanvasRef } from './components/InkCanvas';
import { ScribbleRecognitionModal } from './components/ScribbleRecognitionModal';

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteIdState] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    // Default to split mode on tablets & desktops, text mode on mobile
    return window.innerWidth >= 1024 ? 'both' : 'text';
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const [isScribbleModalOpen, setIsScribbleModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const inkCanvasRef = useRef<InkCanvasRef>(null);
  const saveTimeoutRef = useRef<any>(null);

  // Initialize and load notes from local IndexedDB
  useEffect(() => {
    async function loadData() {
      try {
        const loadedNotes = await getAllNotes();
        setNotes(loadedNotes);

        const lastActiveId = await getActiveNoteId();
        if (lastActiveId && loadedNotes.some((n) => n.id === lastActiveId)) {
          setActiveNoteIdState(lastActiveId);
        } else if (loadedNotes.length > 0) {
          setActiveNoteIdState(loadedNotes[0].id);
        }
      } catch (err) {
        console.error('Error loading notes:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  const activeNote = notes.find((n) => n.id === activeNoteId) || null;

  // Auto-save debouncer
  const scheduleSave = useCallback((noteToSave: Note) => {
    setIsSaving(true);
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await saveNote(noteToSave);
      } catch (err) {
        console.error('Failed to auto-save note:', err);
      } finally {
        setIsSaving(false);
      }
    }, 400);
  }, []);

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

    setNotes((prev) => [newNote, ...prev]);
    setActiveNoteIdState(newNote.id);
    await setActiveNoteId(newNote.id);
    await saveNote(newNote);
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
  };

  // Toggle Pin Note
  const handleTogglePin = (id: string) => {
    const target = notes.find((n) => n.id === id);
    if (!target) return;
    const updated = { ...target, pinned: !target.pinned };
    setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
    scheduleSave(updated);
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

    // Convert HTML content to plain text with line breaks
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
        onToggleOpen={() => setIsSidebarOpen(!isSidebarOpen)}
      />

      {/* Main Content Workspace */}
      <main className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
        <Header
          note={activeNote}
          onUpdateTitle={handleUpdateTitle}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          viewMode={viewMode}
          onChangeViewMode={setViewMode}
          isSaving={isSaving}
          onExport={handleExport}
        />

        {activeNote ? (
          <div className="flex-1 flex flex-col lg:flex-row h-full min-h-0 overflow-hidden relative">
            {/* Keyboard Rich Text Editor View */}
            {(viewMode === 'text' || viewMode === 'both') && (
              <div 
                className={`h-full min-h-0 overflow-hidden flex flex-col ${
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
              <div className="flex-1 h-full min-h-0 overflow-hidden flex flex-col relative">
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
    </div>
  );
}
