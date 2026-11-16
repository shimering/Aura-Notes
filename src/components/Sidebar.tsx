import React, { useEffect, useRef, useState } from 'react';
import { Note } from '../types/note';
import { 
  Plus, 
  Search, 
  Pin, 
  Trash2, 
  PenTool as PenIcon, 
  Tag, 
  FileDown,
  Settings,
  X,
  Download,
  Cloud,
  ChevronDown,
  Sparkles
} from 'lucide-react';
import { NOTE_TEMPLATES } from '../utils/templates';
import { sanitizeNoteHtml } from '../utils/noteHtml';
import { notePages } from '../utils/notePages';
import { TagEditor } from './TagEditor';

interface SidebarProps {
  notes: Note[];
  activeNoteId: string | null;
  onSelectNote: (id: string) => void;
  onCreateNote: (templateId?: string) => void;
  onDeleteNote: (id: string) => void;
  onTogglePin: (id: string) => void;
  onUpdateTitle: (title: string) => void;
  onUpdateTags: (tags: string[]) => void;
  onExport: () => void;
  onOpenSettings: () => void;
  isSaving: boolean;
  isSyncing: boolean;
  isPhone: boolean;
  isOpen: boolean;
  onToggleOpen: () => void;
  onDownloadApp?: () => void;
  onOpenSync?: () => void;
  syncVaultKey?: string;
  accountSyncActive?: boolean;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
}

export const Sidebar: React.FC<SidebarProps> = ({
  notes,
  activeNoteId,
  onSelectNote,
  onCreateNote,
  onDeleteNote,
  onTogglePin,
  onUpdateTitle,
  onUpdateTags,
  onExport,
  onOpenSettings,
  isSaving,
  isSyncing,
  isPhone,
  isOpen,
  onToggleOpen,
  onDownloadApp,
  onOpenSync,
  syncVaultKey = '',
  accountSyncActive = false,
  searchInputRef,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  const [tagEditorNoteId, setTagEditorNoteId] = useState<string>();
  const templateMenuRef = useRef<HTMLDivElement>(null);
  const activeNote = notes.find(({ id }) => id === activeNoteId);

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

  const query = searchQuery.trim().toLowerCase();
  const filteredNotes = notes.filter((note) => {
    const matchesSearch =
      !query ||
      note.title.toLowerCase().includes(query) ||
      notePages(note).some((page) => page.content.toLowerCase().includes(query) ||
        (page.recognizedText || '').toLowerCase().includes(query));
    const matchesTag = selectedTag ? note.tags?.includes(selectedTag) : true;
    return matchesSearch && matchesTag;
  });
  if (isPhone) {
    filteredNotes.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
  }

  const stripHtml = (html: string) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = sanitizeNoteHtml(html);
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
      {isOpen && !isPhone && (
        <div 
          onClick={onToggleOpen}
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-30 md:hidden transition-opacity"
        />
      )}

      <aside
        id="notes-sidebar"
        aria-label="Notes list"
        inert={!isOpen}
        hidden={isPhone && !isOpen}
        className={`fixed md:relative bottom-0 top-[var(--app-safe-top)] md:top-auto left-0 z-40 flex-shrink-0 flex flex-col bg-surface-light dark:bg-surface-dark border-surface-subtle-light dark:border-surface-subtle-dark transition-all duration-300 ease-in-out overflow-hidden ${isPhone ? 'phone-notes' : ''} ${
          isOpen 
            ? 'w-80 border-r translate-x-0 opacity-100' 
            : 'w-0 border-r-0 -translate-x-full md:translate-x-0 opacity-0 pointer-events-none'
        }`}
      >
        <div className="w-80 h-full min-h-0 flex flex-col flex-shrink-0 notes-list-frame">
          {/* Sidebar Header */}
        <div className="notes-list-heading p-4 border-b border-surface-subtle-light dark:border-surface-subtle-dark flex items-center justify-between">
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
            <div ref={templateMenuRef} className="notes-create relative flex items-center">
              <button
                onClick={() => {
                  setIsTemplateMenuOpen(false);
                  onCreateNote();
                }}
                title="Create New Note"
                aria-label="Create new note"
                className="p-2 pl-2.5 rounded-l-xl bg-violet-600 hover:bg-violet-700 text-white shadow-sm transition active:scale-95 flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                {isPhone && <span>New note</span>}
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
                  className="notes-template-menu absolute top-full right-0 mt-2 z-50 w-64 p-1.5 rounded-2xl bg-surface-light dark:bg-surface-dark border border-surface-subtle-light dark:border-surface-subtle-dark shadow-floating animate-in fade-in"
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
            {!isPhone && <button
              onClick={onToggleOpen}
              aria-label="Close notes list"
              className="p-2 rounded-xl text-ink-muted-light hover:text-ink-light dark:text-ink-muted-dark dark:hover:text-ink-dark md:hidden"
            >
              <X className="w-4 h-4" />
            </button>}
          </div>
        </div>

        {isOpen && activeNote && (
          <details key={activeNote.id}
            className="notes-list-actions mx-3 mb-2 rounded-xl bg-surface-subtle-light/60 dark:bg-surface-subtle-dark/60"
            onToggle={(event) => {
              if (!event.currentTarget.open) setTagEditorNoteId(undefined);
            }}>
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold">
              Note actions
              {isSaving && <span className="float-right font-normal" role="status">Saving…</span>}
            </summary>
            <div className="space-y-2 px-3 pb-3">
              {!isPhone && <input aria-label="Note title" type="text" value={activeNote.title} placeholder="Untitled Note"
                onChange={(event) => onUpdateTitle(event.target.value)}
                className="w-full rounded-lg border border-surface-subtle-light bg-surface-light px-2 py-1.5 text-sm dark:border-surface-subtle-dark dark:bg-surface-dark" />}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="ribbon-command" aria-expanded={tagEditorNoteId === activeNote.id}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={() => setTagEditorNoteId(tagEditorNoteId === activeNote.id ? undefined : activeNote.id)}>
                  <Tag size={14} /> Tags
                </button>
                <button type="button" className="ribbon-command" onClick={onExport}>
                  <FileDown size={14} /> Export note
                </button>
              </div>
              {tagEditorNoteId === activeNote.id && (
                <TagEditor tags={activeNote.tags ?? []} allTags={allTags} onChange={onUpdateTags}
                  onClose={() => setTagEditorNoteId(undefined)} />
              )}
            </div>
          </details>
        )}

        {/* Search Bar */}
        <div className="notes-list-search p-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted-light dark:text-ink-muted-dark" />
            <input
              ref={searchInputRef}
              type="search"
              aria-label="Search notes"
              placeholder={isPhone ? 'Search notes or scribbles' : 'Search notes or scribbles... (Ctrl+K)'}
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
              {notes.length ? 'No notes found' : 'No notes yet'}
            </div>
          ) : (
            filteredNotes.map((note, index) => {
              const isActive = note.id === activeNoteId;
              const preview = stripHtml(note.content).trim();
              const hasInk = notePages(note).some((page) => page.inkStrokes?.length);

              return (
                <React.Fragment key={note.id}>
                {isPhone && !query && (index === 0 || (filteredNotes[index - 1].pinned && !note.pinned)) && (
                  <p className="px-3 pt-3 pb-1 text-xs font-semibold text-ink-muted-light dark:text-ink-muted-dark">
                    {note.pinned ? 'Pinned' : 'Recent'}
                  </p>
                )}
                <div
                  className={`group relative p-3 rounded-xl cursor-pointer transition-all ${
                    isActive
                      ? 'bg-surface-subtle-light dark:bg-surface-subtle-dark shadow-sm border-l-4 border-violet-500'
                      : 'hover:bg-surface-subtle-light/60 dark:hover:bg-surface-subtle-dark/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium text-sm text-ink-light dark:text-ink-dark truncate flex-1">
                      <button type="button" aria-current={isActive ? 'true' : undefined}
                        className="truncate max-w-full text-left after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-violet-500"
                        onClick={() => onSelectNote(note.id)}>{note.title || 'Untitled Note'}</button>
                    </h3>
                    <div className="notes-row-actions relative flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
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
                </React.Fragment>
              );
            })
          )}
        </div>

        {/* App shortcuts */}
        <div className="notes-list-shortcuts p-3 border-t border-surface-subtle-light dark:border-surface-subtle-dark flex-shrink-0 space-y-1.5">
          <button type="button" onClick={onOpenSettings} aria-label="Open settings"
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-xl bg-surface-subtle-light/60 dark:bg-surface-subtle-dark/60 text-ink-light dark:text-ink-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark border border-surface-subtle-light dark:border-surface-subtle-dark transition active:scale-95">
            <Settings size={14} />
            <span>Settings</span>
          </button>
          {onOpenSync && (
            <button
              onClick={onOpenSync} aria-label={isSyncing ? 'Syncing notes' : 'Cross-device sync'}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-xl bg-surface-subtle-light/60 dark:bg-surface-subtle-dark/60 text-ink-light dark:text-ink-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark border border-surface-subtle-light dark:border-surface-subtle-dark transition active:scale-95"
            >
              <div className="flex items-center gap-2">
                <Cloud className={`w-3.5 h-3.5 ${accountSyncActive || syncVaultKey ? 'text-emerald-500' : 'text-violet-500'}`} />
                <span>
                  {isSyncing
                    ? 'Syncing notes…'
                    : accountSyncActive
                    ? 'Account Sync: Active'
                    : syncVaultKey
                      ? 'Cross-Device Sync: Active'
                      : 'Enable Cross-Device Sync'}
                </span>
              </div>
              {(accountSyncActive || syncVaultKey) && (
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              )}
            </button>
          )}

          {onDownloadApp && (
            <button
              onClick={onDownloadApp} aria-label="Download app on home screen"
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
