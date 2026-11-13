import React, { useEffect, useRef, useState } from 'react';
import { Note } from '../types/note';
import { 
  Plus, 
  Search, 
  Pin, 
  Trash2, 
  PenTool as PenIcon, 
  Tag, 
  FileText,
  ChevronLeft,
  X,
  Download,
  Cloud,
  ChevronDown,
  Sparkles
} from 'lucide-react';
import { NOTE_TEMPLATES } from '../utils/templates';

interface SidebarProps {
  notes: Note[];
  activeNoteId: string | null;
  onSelectNote: (id: string) => void;
  onCreateNote: (templateId?: string) => void;
  onDeleteNote: (id: string) => void;
  onTogglePin: (id: string) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  onDownloadApp?: () => void;
  onOpenSync?: () => void;
  syncVaultKey?: string;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
}

export const Sidebar: React.FC<SidebarProps> = ({
  notes,
  activeNoteId,
  onSelectNote,
  onCreateNote,
  onDeleteNote,
  onTogglePin,
  isOpen,
  onToggleOpen,
  onDownloadApp,
  onOpenSync,
  syncVaultKey = '',
  searchInputRef,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  const templateMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isTemplateMenuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (templateMenuRef.current && !templateMenuRef.current.contains(e.target as Node)) {
        setIsTemplateMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isTemplateMenuOpen]);

  // Extract all unique tags
  const allTags = Array.from(
    new Set(notes.flatMap((n) => n.tags || []))
  );

  const filteredNotes = notes.filter((note) => {
    const matchesSearch =
      note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      note.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTag = selectedTag ? note.tags?.includes(selectedTag) : true;
    return matchesSearch && matchesTag;
  });

  const stripHtml = (html: string) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div 
          onClick={onToggleOpen}
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-30 md:hidden transition-opacity"
        />
      )}

      <aside
        className={`fixed md:relative inset-y-0 left-0 z-40 flex-shrink-0 flex flex-col bg-surface-light dark:bg-surface-dark border-surface-subtle-light dark:border-surface-subtle-dark transition-all duration-300 ease-in-out overflow-hidden ${
          isOpen 
            ? 'w-80 border-r translate-x-0 opacity-100' 
            : 'w-0 border-r-0 -translate-x-full md:translate-x-0 opacity-0 pointer-events-none'
        }`}
      >
        <div className="w-80 h-full flex flex-col flex-shrink-0">
          {/* Sidebar Header */}
        <div className="p-4 border-b border-surface-subtle-light dark:border-surface-subtle-dark flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-violet-600 via-indigo-600 to-pink-500 flex items-center justify-center text-white shadow-sm">
              <PenIcon className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-semibold text-base tracking-tight text-ink-light dark:text-ink-dark">
                Aura Notes
              </h2>
              <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">
                {notes.length} {notes.length === 1 ? 'note' : 'notes'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <div ref={templateMenuRef} className="relative flex items-center">
              <button
                onClick={() => onCreateNote()}
                title="Create New Note"
                className="p-2 pl-2.5 rounded-l-xl bg-violet-600 hover:bg-violet-700 text-white shadow-sm transition active:scale-95"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsTemplateMenuOpen((open) => !open)}
                title="New note from template"
                aria-haspopup="menu"
                aria-expanded={isTemplateMenuOpen}
                className="p-2 pr-2.5 rounded-r-xl bg-violet-600 hover:bg-violet-700 text-white shadow-sm transition active:scale-95 border-l border-white/25"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>

              {isTemplateMenuOpen && (
                <div
                  role="menu"
                  className="absolute top-full right-0 mt-2 z-50 w-64 p-1.5 rounded-2xl bg-surface-light dark:bg-surface-dark border border-surface-subtle-light dark:border-surface-subtle-dark shadow-floating animate-in fade-in slide-in-from-top-1"
                >
                  <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-ink-muted-light dark:text-ink-muted-dark">
                    New from template
                  </p>
                  {NOTE_TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      role="menuitem"
                      onClick={() => {
                        setIsTemplateMenuOpen(false);
                        onCreateNote(template.id);
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark transition flex items-start gap-2"
                    >
                      <Sparkles className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-violet-500" />
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold text-ink-light dark:text-ink-dark">
                          {template.name}
                        </span>
                        <span className="block text-[11px] leading-snug text-ink-muted-light dark:text-ink-muted-dark">
                          {template.description}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={onToggleOpen}
              className="p-2 rounded-xl text-ink-muted-light hover:text-ink-light dark:text-ink-muted-dark dark:hover:text-ink-dark md:hidden"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="p-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted-light dark:text-ink-muted-dark" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search notes or scribbles... (Ctrl+K)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-xl bg-surface-subtle-light dark:bg-surface-subtle-dark border-none outline-none focus:ring-2 focus:ring-violet-500 text-ink-light dark:text-ink-dark placeholder-ink-muted-light dark:placeholder-ink-muted-dark transition"
            />
          </div>

          {/* Tags row */}
          {allTags.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2.5 overflow-x-auto pb-1 no-scrollbar text-xs">
              <button
                onClick={() => setSelectedTag(null)}
                className={`px-2.5 py-1 rounded-lg font-medium transition whitespace-nowrap ${
                  selectedTag === null
                    ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
                    : 'text-ink-muted-light dark:text-ink-muted-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark'
                }`}
              >
                All
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                  className={`px-2.5 py-1 rounded-lg font-medium transition whitespace-nowrap flex items-center gap-1 ${
                    selectedTag === tag
                      ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
                      : 'text-ink-muted-light dark:text-ink-muted-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark'
                  }`}
                >
                  <Tag className="w-3 h-3" />
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Notes List */}
        <div className="flex-1 overflow-y-auto px-2 space-y-1.5 pb-4">
          {filteredNotes.length === 0 ? (
            <div className="py-12 text-center text-sm text-ink-muted-light dark:text-ink-muted-dark">
              No notes found
            </div>
          ) : (
            filteredNotes.map((note) => {
              const isActive = note.id === activeNoteId;
              const preview = stripHtml(note.content).trim();
              const hasInk = note.inkStrokes && note.inkStrokes.length > 0;

              return (
                <div
                  key={note.id}
                  onClick={() => onSelectNote(note.id)}
                  className={`group relative p-3 rounded-xl cursor-pointer transition-all ${
                    isActive
                      ? 'bg-surface-subtle-light dark:bg-surface-subtle-dark shadow-sm border-l-4 border-violet-500'
                      : 'hover:bg-surface-subtle-light/60 dark:hover:bg-surface-subtle-dark/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium text-sm text-ink-light dark:text-ink-dark truncate flex-1">
                      {note.title || 'Untitled Note'}
                    </h3>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onTogglePin(note.id);
                        }}
                        title={note.pinned ? 'Unpin' : 'Pin to top'}
                        className={`p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 ${
                          note.pinned ? 'text-amber-500' : 'text-ink-muted-light dark:text-ink-muted-dark'
                        }`}
                      >
                        <Pin className="w-3.5 h-3.5 fill-current" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete "${note.title}"?`)) {
                            onDeleteNote(note.id);
                          }
                        }}
                        title="Delete note"
                        className="p-1 rounded text-red-400 hover:text-red-500 hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark line-clamp-2 mt-1 leading-relaxed">
                    {preview || (hasInk ? 'Handwritten note...' : 'Empty note')}
                  </p>

                  <div className="flex items-center justify-between mt-2 pt-1 text-[11px] text-ink-muted-light dark:text-ink-muted-dark">
                    <span>{formatDate(note.updatedAt)}</span>
                    <div className="flex items-center gap-1.5">
                      {hasInk && (
                        <span 
                          title="Contains Apple Pencil / S Pen handwriting" 
                          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 font-medium"
                        >
                          <PenIcon className="w-2.5 h-2.5" />
                          Ink
                        </span>
                      )}
                      {note.pinned && (
                        <Pin className="w-3 h-3 text-amber-500 fill-amber-500" />
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Sidebar Footer with Sync & Download App shortcuts */}
        <div className="p-3 border-t border-surface-subtle-light dark:border-surface-subtle-dark flex-shrink-0 space-y-1.5">
          {onOpenSync && (
            <button
              onClick={onOpenSync}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-xl bg-surface-subtle-light/60 dark:bg-surface-subtle-dark/60 text-ink-light dark:text-ink-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark border border-surface-subtle-light dark:border-surface-subtle-dark transition active:scale-95"
            >
              <div className="flex items-center gap-2">
                <Cloud className={`w-3.5 h-3.5 ${syncVaultKey ? 'text-emerald-500' : 'text-violet-500'}`} />
                <span>{syncVaultKey ? 'Cross-Device Sync: Active' : 'Enable Cross-Device Sync'}</span>
              </div>
              {syncVaultKey && (
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              )}
            </button>
          )}

          {onDownloadApp && (
            <button
              onClick={onDownloadApp}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-xl bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-violet-950/40 dark:text-violet-300 dark:hover:bg-violet-900/50 border border-violet-200/50 dark:border-violet-800/40 transition active:scale-95"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download App on Home Screen</span>
            </button>
          )}
        </div>
      </div>
    </aside>
    </>
  );
};
