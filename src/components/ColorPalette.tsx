import React, { useState } from 'react';
import { Palette, Highlighter } from 'lucide-react';

export const TEXT_COLORS = [
  { name: 'Default', value: 'inherit', hex: '#64748b' },
  { name: 'Charcoal', value: '#1e293b', hex: '#1e293b' },
  { name: 'Ocean Blue', value: '#2563eb', hex: '#2563eb' },
  { name: 'Violet', value: '#7c3aed', hex: '#7c3aed' },
  { name: 'Emerald', value: '#059669', hex: '#059669' },
  { name: 'Crimson', value: '#dc2626', hex: '#dc2626' },
  { name: 'Amber', value: '#d97706', hex: '#d97706' },
  { name: 'Rose', value: '#e11d48', hex: '#e11d48' },
  { name: 'Teal', value: '#0d9488', hex: '#0d9488' },
];

export const HIGHLIGHT_COLORS = [
  { name: 'None', value: 'transparent', hex: 'transparent' },
  { name: 'Yellow', value: '#fef08a', hex: '#fef08a' },
  { name: 'Green', value: '#bbf7d0', hex: '#bbf7d0' },
  { name: 'Blue', value: '#bfdbfe', hex: '#bfdbfe' },
  { name: 'Purple', value: '#e9d5ff', hex: '#e9d5ff' },
  { name: 'Pink', value: '#fbcfe8', hex: '#fbcfe8' },
  { name: 'Orange', value: '#fed7aa', hex: '#fed7aa' },
];

interface ColorPaletteProps {
  onSelectTextColor: (color: string) => void;
  onSelectHighlightColor: (color: string) => void;
}

export const ColorPalette: React.FC<ColorPaletteProps> = ({
  onSelectTextColor,
  onSelectHighlightColor
}) => {
  const [activeTab, setActiveTab] = useState<'text' | 'highlight'>('text');
  const [customColor, setCustomColor] = useState('#2563eb');

  return (
    <div className="p-3 w-64 bg-surface-light dark:bg-surface-dark rounded-2xl shadow-xl border border-surface-subtle-light dark:border-surface-subtle-dark">
      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-surface-subtle-light dark:bg-surface-subtle-dark rounded-xl mb-3 text-xs font-medium">
        <button
          type="button"
          onClick={() => setActiveTab('text')}
          className={`flex-1 py-1 px-2 rounded-lg flex items-center justify-center gap-1.5 transition ${
            activeTab === 'text'
              ? 'bg-surface-light dark:bg-surface-dark text-violet-600 dark:text-violet-400 shadow-sm'
              : 'text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-light'
          }`}
        >
          <Palette className="w-3.5 h-3.5" />
          Text Color
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('highlight')}
          className={`flex-1 py-1 px-2 rounded-lg flex items-center justify-center gap-1.5 transition ${
            activeTab === 'highlight'
              ? 'bg-surface-light dark:bg-surface-dark text-violet-600 dark:text-violet-400 shadow-sm'
              : 'text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-light'
          }`}
        >
          <Highlighter className="w-3.5 h-3.5" />
          Highlight
        </button>
      </div>

      {activeTab === 'text' ? (
        <div>
          <div className="grid grid-cols-5 gap-2 mb-3">
            {TEXT_COLORS.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => onSelectTextColor(c.value)}
                title={c.name}
                className="w-8 h-8 rounded-full border border-black/10 dark:border-white/10 flex items-center justify-center hover:scale-110 transition active:scale-95 shadow-sm"
                style={{ backgroundColor: c.value === 'inherit' ? '#e2e8f0' : c.value }}
              >
                {c.value === 'inherit' && (
                  <span className="text-[10px] text-slate-700 font-bold">A</span>
                )}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-surface-subtle-light dark:border-surface-subtle-dark">
            <span className="text-xs text-ink-muted-light dark:text-ink-muted-dark">Custom:</span>
            <input
              type="color"
              value={customColor}
              onChange={(e) => {
                setCustomColor(e.target.value);
                onSelectTextColor(e.target.value);
              }}
              className="w-7 h-7 rounded-lg border-0 cursor-pointer bg-transparent"
            />
            <span className="text-xs font-mono text-ink-muted-light dark:text-ink-muted-dark uppercase">
              {customColor}
            </span>
          </div>
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-4 gap-2 mb-2">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => onSelectHighlightColor(c.value)}
                title={c.name}
                className={`h-8 rounded-xl border border-black/10 dark:border-white/10 flex items-center justify-center text-xs font-medium hover:scale-105 transition active:scale-95 shadow-sm ${
                  c.value === 'transparent' ? 'bg-transparent text-ink-muted-light' : 'text-slate-800'
                }`}
                style={{ backgroundColor: c.value }}
              >
                {c.name === 'None' ? 'Clear' : ''}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
