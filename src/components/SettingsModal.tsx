import React from 'react';
import {
  X,
  Settings as SettingsIcon,
  Sun,
  Moon,
  Type,
  Columns,
  PenTool,
  Cloud,
  Feather,
  Pen,
  Highlighter,
  ShieldCheck
} from 'lucide-react';
import { AppSettings } from '../types/settings';
import { EraserMode, PenTool as PenToolType } from '../types/note';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  onOpenSync: () => void;
}

const PEN_TOOLS: { id: PenToolType; name: string; icon: React.ReactNode }[] = [
  { id: 'fountain', name: 'Fountain', icon: <Feather className="w-4 h-4" /> },
  { id: 'pen', name: 'Ballpoint', icon: <Pen className="w-4 h-4" /> },
  { id: 'highlighter', name: 'Highlighter', icon: <Highlighter className="w-4 h-4" /> }
];

const INK_COLORS = ['#1e293b', '#000000', '#2563eb', '#7c3aed', '#059669', '#dc2626', '#d97706', '#ffffff'];

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted-light dark:text-ink-muted-dark">
    {children}
  </h4>
);

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  onOpenSync
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-3xl bg-surface-light dark:bg-surface-dark border border-surface-subtle-light dark:border-surface-subtle-dark shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-surface-subtle-light dark:border-surface-subtle-dark flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-violet-600 via-indigo-600 to-sky-500 flex items-center justify-center text-white shadow-md">
              <SettingsIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-ink-light dark:text-ink-dark">Settings</h3>
              <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">
                Appearance, stylus defaults, and sync
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="p-2 rounded-xl text-ink-muted-light hover:text-ink-light dark:text-ink-muted-dark dark:hover:text-ink-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-6 text-sm">
          {/* Appearance */}
          <section className="space-y-2.5">
            <SectionTitle>Appearance</SectionTitle>

            <div className="flex items-center justify-between p-3 rounded-2xl bg-surface-subtle-light/60 dark:bg-surface-subtle-dark/60">
              <div>
                <p className="text-xs font-semibold text-ink-light dark:text-ink-dark">Theme</p>
                <p className="text-[11px] text-ink-muted-light dark:text-ink-muted-dark">
                  Light for daylight, dark for late-night writing
                </p>
              </div>
              <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-light dark:bg-surface-dark">
                <button
                  onClick={() => onUpdateSettings({ theme: 'light' })}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    settings.theme === 'light'
                      ? 'bg-surface-subtle-light dark:bg-surface-subtle-dark text-amber-600 shadow-sm'
                      : 'text-ink-muted-light dark:text-ink-muted-dark'
                  }`}
                >
                  <Sun className="w-3.5 h-3.5" />
                  Light
                </button>
                <button
                  onClick={() => onUpdateSettings({ theme: 'dark' })}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    settings.theme === 'dark'
                      ? 'bg-surface-subtle-light dark:bg-surface-subtle-dark text-violet-400 shadow-sm'
                      : 'text-ink-muted-light dark:text-ink-muted-dark'
                  }`}
                >
                  <Moon className="w-3.5 h-3.5" />
                  Dark
                </button>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-surface-subtle-light/60 dark:bg-surface-subtle-dark/60">
              <p className="text-xs font-semibold text-ink-light dark:text-ink-dark mb-2">Default Layout</p>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'text' as const, label: 'Text', icon: <Type className="w-3.5 h-3.5" /> },
                  { id: 'both' as const, label: 'Split', icon: <Columns className="w-3.5 h-3.5" /> },
                  { id: 'ink' as const, label: 'Canvas', icon: <PenTool className="w-3.5 h-3.5" /> }
                ].map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => onUpdateSettings({ viewMode: mode.id })}
                    className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition ${
                      settings.viewMode === mode.id
                        ? 'bg-violet-600 text-white shadow-sm'
                        : 'bg-surface-light dark:bg-surface-dark text-ink-light dark:text-ink-dark hover:bg-violet-50 dark:hover:bg-violet-950/30'
                    }`}
                  >
                    {mode.icon}
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Stylus defaults */}
          <section className="space-y-2.5">
            <SectionTitle>Stylus Defaults</SectionTitle>

            <div className="p-3 rounded-2xl bg-surface-subtle-light/60 dark:bg-surface-subtle-dark/60 space-y-3">
              <div>
                <p className="text-xs font-semibold text-ink-light dark:text-ink-dark mb-2">Pen Style</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {PEN_TOOLS.map((tool) => (
                    <button
                      key={tool.id}
                      onClick={() => onUpdateSettings({ defaultPenTool: tool.id })}
                      className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition ${
                        settings.defaultPenTool === tool.id
                          ? 'bg-violet-600 text-white shadow-sm'
                          : 'bg-surface-light dark:bg-surface-dark text-ink-light dark:text-ink-dark hover:bg-violet-50 dark:hover:bg-violet-950/30'
                      }`}
                    >
                      {tool.icon}
                      {tool.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-ink-light dark:text-ink-dark mb-2">
                  Ink Color
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  {INK_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => onUpdateSettings({ defaultPenColor: color })}
                      title={color}
                      aria-label={`Default ink color ${color}`}
                      className={`w-7 h-7 rounded-full border border-black/10 dark:border-white/20 transition ${
                        settings.defaultPenColor.toLowerCase() === color
                          ? 'ring-2 ring-violet-500 ring-offset-2 ring-offset-white dark:ring-offset-gray-900 scale-110'
                          : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                  <input
                    type="color"
                    value={settings.defaultPenColor}
                    onChange={(e) => onUpdateSettings({ defaultPenColor: e.target.value })}
                    title="Custom default ink color"
                    className="w-7 h-7 rounded-full border-0 bg-transparent cursor-pointer"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-semibold text-ink-light dark:text-ink-dark">Stroke Width</p>
                  <span className="text-[11px] font-mono text-ink-muted-light dark:text-ink-muted-dark">
                    {settings.defaultPenWidth}px
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={16}
                  step={1}
                  value={settings.defaultPenWidth}
                  onChange={(e) => onUpdateSettings({ defaultPenWidth: Number(e.target.value) })}
                  className="w-full accent-violet-600"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-semibold text-ink-light dark:text-ink-dark">Eraser Mode</p>
                  <div className="flex items-center gap-1 p-0.5 rounded-lg bg-surface-light dark:bg-surface-dark">
                    {(['object', 'pixel'] as EraserMode[]).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => onUpdateSettings({ defaultEraserMode: mode })}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${
                          settings.defaultEraserMode === mode
                            ? 'bg-rose-500 text-white shadow-sm'
                            : 'text-ink-muted-light dark:text-ink-muted-dark'
                        }`}
                      >
                        {mode === 'object' ? 'Object' : 'Pixel'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-semibold text-ink-light dark:text-ink-dark">Eraser Size</p>
                  <span className="text-[11px] font-mono text-ink-muted-light dark:text-ink-muted-dark">
                    {settings.defaultEraserWidth}px
                  </span>
                </div>
                <input
                  type="range"
                  min={8}
                  max={64}
                  step={4}
                  value={settings.defaultEraserWidth}
                  onChange={(e) => onUpdateSettings({ defaultEraserWidth: Number(e.target.value) })}
                  className="w-full accent-rose-500"
                />
                <p className="text-[11px] text-ink-muted-light dark:text-ink-muted-dark mt-1">
                  Object removes whole strokes. Pixel erases only the covered part.
                </p>
              </div>

              <label className="flex items-center justify-between cursor-pointer">
                <div className="pr-3">
                  <p className="text-xs font-semibold text-ink-light dark:text-ink-dark flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                    Stylus-Only Palm Shield
                  </p>
                  <p className="text-[11px] text-ink-muted-light dark:text-ink-muted-dark mt-0.5">
                    Ignore finger and palm input on the canvas by default
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.stylusOnly}
                  onChange={(e) => onUpdateSettings({ stylusOnly: e.target.checked })}
                  className="w-4 h-4 accent-violet-600 cursor-pointer"
                />
              </label>
            </div>
          </section>

          {/* Sync */}
          <section className="space-y-2.5">
            <SectionTitle>Sync</SectionTitle>
            <div className="flex items-center justify-between p-3 rounded-2xl bg-surface-subtle-light/60 dark:bg-surface-subtle-dark/60">
              <div>
                <p className="text-xs font-semibold text-ink-light dark:text-ink-dark flex items-center gap-1.5">
                  <Cloud className="w-3.5 h-3.5 text-violet-500" />
                  {settings.syncVaultKey ? 'Cloud Vault Connected' : 'Cloud Vault Not Connected'}
                </p>
                <p className="text-[11px] text-ink-muted-light dark:text-ink-muted-dark mt-0.5">
                  {settings.syncVaultKey
                    ? `Vault: ${settings.syncVaultKey}`
                    : 'Pair devices to mirror notes and ink automatically'}
                </p>
              </div>
              <button
                onClick={() => {
                  onClose();
                  onOpenSync();
                }}
                className="px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold shadow-sm transition active:scale-95"
              >
                {settings.syncVaultKey ? 'Manage' : 'Connect'}
              </button>
            </div>
          </section>
        </div>

        <div className="p-4 border-t border-surface-subtle-light dark:border-surface-subtle-dark bg-surface-subtle-light/30 dark:bg-surface-subtle-dark/30 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold shadow-md active:scale-95 transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
