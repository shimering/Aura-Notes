import React, { useState, useEffect, useRef } from 'react';
import { 
  Menu, 
  Moon, 
  Sun, 
  Download, 
  FileDown,
  Check, 
  Sparkles,
  Type, 
  PenTool, 
  Columns,
  Share2,
  Cloud,
  RefreshCw,
  Tag,
  Settings
} from 'lucide-react';
import { Note } from '../types/note';
import { TagEditor } from './TagEditor';

export type ViewMode = 'both' | 'text' | 'ink';

interface HeaderProps {
  note: Note | null;
  onUpdateTitle: (title: string) => void;
  onUpdateTags?: (tags: string[]) => void;
  allTags?: string[];
  onToggleSidebar: () => void;
  isSidebarOpen?: boolean;
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  isSaving: boolean;
  onExport: () => void;
  onOpenInstall?: () => void;
  onOpenSync?: () => void;
  onOpenSettings?: () => void;
  isSyncing?: boolean;
  syncVaultKey?: string;
}

export const Header: React.FC<HeaderProps> = ({
  note,
  onUpdateTitle,
  onUpdateTags,
  allTags = [],
  onToggleSidebar,
  isSidebarOpen = true,
  viewMode,
  onChangeViewMode,
  isSaving,
  onExport,
  onOpenInstall,
  onOpenSync,
  onOpenSettings,
  isSyncing = false,
  syncVaultKey = ''
}) => {
  const [isTagEditorOpen, setIsTagEditorOpen] = useState(false);
  const tagButtonRef = useRef<HTMLDivElement>(null);
  const [isDark, setIsDark] = useState(() => {
    return document.documentElement.classList.contains('dark');
  });

  const [installPrompt, setInstallPrompt] = useState<any>(null);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallPWA = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallPrompt(null);
    }
  };

  const toggleTheme = () => {
    if (isDark) {
      document.documentElement.classList.remove('dark');
      setIsDark(false);
    } else {
      document.documentElement.classList.add('dark');
      setIsDark(true);
    }
  };

  return (
    <header className="h-14 border-b border-surface-subtle-light dark:border-surface-subtle-dark bg-surface-light/80 dark:bg-surface-dark/80 backdrop-blur-md px-4 flex items-center justify-between gap-3 select-none flex-shrink-0 z-20">
      {/* Left controls */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <button
          onClick={onToggleSidebar}
          title={isSidebarOpen ? "Hide notes list (Maximize panels to full screen)" : "Show notes list"}
          className={`p-2 rounded-xl transition ${
            !isSidebarOpen 
              ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300 ring-1 ring-violet-500/30' 
              : 'text-ink-muted-light hover:text-ink-light dark:text-ink-muted-dark dark:hover:text-ink-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark'
          }`}
        >
          <Menu className="w-5 h-5" />
        </button>

        {note ? (
          <input
            type="text"
            value={note.title}
            placeholder="Untitled Note..."
            onChange={(e) => onUpdateTitle(e.target.value)}
            className="font-semibold text-base bg-transparent border-none outline-none text-ink-light dark:text-ink-dark placeholder-ink-muted-light/60 dark:placeholder-ink-muted-dark/60 truncate flex-1 max-w-md focus:ring-1 focus:ring-violet-500 rounded px-1 transition"
          />
        ) : (
          <span className="text-sm font-medium text-ink-muted-light dark:text-ink-muted-dark">
            Select or create a note
          </span>
        )}

        {/* Tags */}
        {note && onUpdateTags && (
          <div ref={tagButtonRef} className="relative flex-shrink-0">
            <button
              onClick={() => setIsTagEditorOpen((open) => !open)}
              onMouseDown={(e) => e.stopPropagation()}
              title="Edit note tags"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition active:scale-95 ${
                (note.tags?.length || 0) > 0
                  ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300 ring-1 ring-violet-500/30'
                  : 'text-ink-muted-light hover:text-ink-light dark:text-ink-muted-dark dark:hover:text-ink-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark'
              }`}
            >
              <Tag className="w-3.5 h-3.5" />
              <span className="hidden md:inline">
                {note.tags && note.tags.length > 0
                  ? note.tags.length === 1
                    ? note.tags[0]
                    : `${note.tags.length} tags`
                  : 'Tags'}
              </span>
            </button>

            {isTagEditorOpen && (
              <TagEditor
                tags={note.tags || []}
                allTags={allTags}
                onChange={onUpdateTags}
                onClose={() => setIsTagEditorOpen(false)}
              />
            )}
          </div>
        )}

        {/* Save status badge */}
        <span className="hidden sm:inline-flex items-center text-xs text-ink-muted-light dark:text-ink-muted-dark px-2 py-0.5">
          {isSaving ? (
            <span className="animate-pulse">Saving...</span>
          ) : (
            <span className="flex items-center gap-1 opacity-75">
              <Check className="w-3 h-3 text-emerald-500" /> Saved
            </span>
          )}
        </span>
      </div>

      {/* Middle: Mode Switcher (Split, Text Only, Ink Only) */}
      <div className="flex items-center bg-surface-subtle-light dark:bg-surface-subtle-dark p-1 rounded-xl gap-1">
        <button
          onClick={() => onChangeViewMode('text')}
          title="Keyboard Text Mode"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            viewMode === 'text'
              ? 'bg-surface-light dark:bg-surface-dark text-violet-600 dark:text-violet-400 shadow-sm'
              : 'text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-light'
          }`}
        >
          <Type className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Text</span>
        </button>
        <button
          onClick={() => onChangeViewMode('both')}
          title="Split View: Stylus + Keyboard"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            viewMode === 'both'
              ? 'bg-surface-light dark:bg-surface-dark text-violet-600 dark:text-violet-400 shadow-sm'
              : 'text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-light'
          }`}
        >
          <Columns className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Split</span>
        </button>
        <button
          onClick={() => onChangeViewMode('ink')}
          title="Stylus Drawing Mode (S Pen / Apple Pencil)"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            viewMode === 'ink'
              ? 'bg-surface-light dark:bg-surface-dark text-violet-600 dark:text-violet-400 shadow-sm'
              : 'text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-light'
          }`}
        >
          <PenTool className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Stylus Canvas</span>
        </button>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-2">
        {/* Cross-Device Cloud Sync Button */}
        <button
          onClick={onOpenSync}
          title={
            isSyncing 
              ? 'Syncing with cloud vault...' 
              : syncVaultKey 
                ? `Cross-Device Sync Active (Vault: ${syncVaultKey})` 
                : 'Connect Cross-Device Cloud Sync'
          }
          className="p-2 rounded-xl text-ink-muted-light hover:text-ink-light dark:text-ink-muted-dark dark:hover:text-ink-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark transition relative active:scale-95"
        >
          {isSyncing ? (
            <RefreshCw className="w-4 h-4 text-violet-500 animate-spin" />
          ) : syncVaultKey ? (
            <div className="relative">
              <Cloud className="w-4 h-4 text-emerald-500" />
              <span className="w-2 h-2 rounded-full bg-emerald-500 absolute -top-1 -right-1 ring-2 ring-white dark:ring-surface-dark" />
            </div>
          ) : (
            <Cloud className="w-4 h-4" />
          )}
        </button>

        {/* Download App to Home Screen Button */}
        <button
          onClick={() => {
            if (onOpenInstall) {
              onOpenInstall();
            } else if (installPrompt) {
              handleInstallPWA();
            }
          }}
          title="Download Aura Notes as an app on your Home Screen"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-violet-600 hover:bg-violet-700 text-white shadow-sm transition active:scale-95"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Download App</span>
        </button>

        <button
          onClick={onExport}
          title="Export Note (Markdown / Text)"
          className="p-2 rounded-xl text-ink-muted-light hover:text-ink-light dark:text-ink-muted-dark dark:hover:text-ink-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark transition"
        >
          <FileDown className="w-4 h-4" />
        </button>

        <button
          onClick={toggleTheme}
          title="Toggle Dark / Light Mode"
          className="p-2 rounded-xl text-ink-muted-light hover:text-ink-light dark:text-ink-muted-dark dark:hover:text-ink-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark transition"
        >
          {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
        </button>

        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Open settings"
            className="p-2 rounded-xl text-ink-muted-light hover:text-ink-light dark:text-ink-muted-dark dark:hover:text-ink-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark transition active:scale-95"
          >
            <Settings className="w-4 h-4" />
          </button>
        )}
      </div>
    </header>
  );
};
