import React from 'react';
import { 
  Pen, 
  Feather, 
  Highlighter, 
  Eraser, 
  Undo2, 
  Redo2, 
  Trash2, 
  Wand2,
  ShieldCheck,
  ShieldAlert,
  Sparkles
} from 'lucide-react';
import { PenTool } from '../types/note';

export const INK_PALETTE = [
  { name: 'Pure White (Dark Mode)', hex: '#ffffff' },
  { name: 'Platinum', hex: '#e2e8f0' },
  { name: 'Charcoal', hex: '#1e293b' },
  { name: 'Pure Black', hex: '#000000' },
  { name: 'Ocean Blue', hex: '#2563eb' },
  { name: 'Midnight Navy', hex: '#1e3a8a' },
  { name: 'Emerald', hex: '#059669' },
  { name: 'Crimson', hex: '#dc2626' },
  { name: 'Violet', hex: '#7c3aed' },
  { name: 'Amber', hex: '#d97706' },
];

export const HIGHLIGHTER_PALETTE = [
  { name: 'Pastel Yellow', hex: '#fef08a' },
  { name: 'Pastel Green', hex: '#86efac' },
  { name: 'Pastel Blue', hex: '#93c5fd' },
  { name: 'Pastel Purple', hex: '#d8b4fe' },
  { name: 'Pastel Pink', hex: '#f472b6' },
  { name: 'Pastel Orange', hex: '#fdba74' },
];

interface PenToolbarProps {
  activeTool: PenTool;
  onSelectTool: (tool: PenTool) => void;
  color: string;
  onChangeColor: (color: string) => void;
  width: number;
  onChangeWidth: (width: number) => void;
  eraserWidth?: number;
  onChangeEraserWidth?: (width: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onScribbleToText: () => void;
  hasStrokes: boolean;
  isStylusOnly: boolean;
  onToggleStylusOnly: () => void;
  onOpenSPenMenu?: () => void;
}

export const PenToolbar: React.FC<PenToolbarProps> = ({
  activeTool,
  onSelectTool,
  color,
  onChangeColor,
  width,
  onChangeWidth,
  eraserWidth,
  onChangeEraserWidth,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  onScribbleToText,
  hasStrokes,
  isStylusOnly,
  onToggleStylusOnly,
  onOpenSPenMenu
}) => {
  const currentPalette = activeTool === 'highlighter' ? HIGHLIGHTER_PALETTE : INK_PALETTE;

  return (
    <div className="flex items-center flex-wrap gap-1.5 p-2 rounded-2xl glass-panel shadow-floating border border-surface-subtle-light dark:border-surface-subtle-dark select-none">
      {/* Tool Selection */}
      <div className="flex items-center gap-1 pr-2 border-r border-surface-subtle-light dark:border-surface-subtle-dark">
        <button
          type="button"
          onClick={() => onSelectTool('fountain')}
          title="Fountain Pen (Calligraphic, Pressure Sensitive)"
          className={`p-2 rounded-xl transition active:scale-95 flex items-center justify-center ${
            activeTool === 'fountain'
              ? 'bg-violet-600 text-white shadow-md'
              : 'hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark'
          }`}
        >
          <Feather className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => onSelectTool('pen')}
          title="Ballpoint Pen (Smooth, Consistent)"
          className={`p-2 rounded-xl transition active:scale-95 flex items-center justify-center ${
            activeTool === 'pen'
              ? 'bg-violet-600 text-white shadow-md'
              : 'hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark'
          }`}
        >
          <Pen className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => onSelectTool('highlighter')}
          title="Highlighter (Semi-transparent)"
          className={`p-2 rounded-xl transition active:scale-95 flex items-center justify-center ${
            activeTool === 'highlighter'
              ? 'bg-amber-500 text-white shadow-md'
              : 'hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark'
          }`}
        >
          <Highlighter className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => onSelectTool('eraser')}
          title="Eraser (S Pen button also triggers eraser)"
          className={`p-2 rounded-xl transition active:scale-95 flex items-center justify-center ${
            activeTool === 'eraser'
              ? 'bg-rose-500 text-white shadow-md'
              : 'hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark'
          }`}
        >
          <Eraser className="w-4 h-4" />
        </button>

        {onOpenSPenMenu && (
          <button
            type="button"
            onClick={onOpenSPenMenu}
            title="S Pen Quick Menu (or press S Pen side button once)"
            className="p-2 rounded-xl transition active:scale-95 flex items-center justify-center text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/40"
          >
            <Sparkles className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Colors (only show if not eraser) */}
      {activeTool !== 'eraser' && (
        <div className="flex items-center gap-1.5 pr-2 border-r border-surface-subtle-light dark:border-surface-subtle-dark">
          {currentPalette.map((item) => (
            <button
              key={item.hex}
              type="button"
              onClick={() => onChangeColor(item.hex)}
              title={item.name}
              className={`w-6 h-6 rounded-full border transition active:scale-90 ${
                color === item.hex
                  ? 'ring-2 ring-violet-500 ring-offset-2 ring-offset-white dark:ring-offset-gray-900 scale-110'
                  : 'border-black/10 dark:border-white/10 opacity-80 hover:opacity-100'
              }`}
              style={{ backgroundColor: item.hex }}
            />
          ))}
          {/* Custom color picker */}
          <input
            type="color"
            value={color}
            onChange={(e) => onChangeColor(e.target.value)}
            title="Custom Color"
            className="w-6 h-6 rounded-full border-0 cursor-pointer bg-transparent"
          />
        </div>
      )}

      {/* Width / Size Selector (Adapts to Pen vs Eraser) */}
      <div className="flex items-center gap-1.5 px-2 border-r border-surface-subtle-light dark:border-surface-subtle-dark">
        {activeTool === 'eraser' ? (
          // Eraser Sizes: Small (12px), Medium (24px), Large (36px), Extra Large (56px)
          [12, 24, 36, 56].map((size) => {
            const currentEraserSize = eraserWidth ?? 24;
            const isSelected = currentEraserSize === size;
            return (
              <button
                key={size}
                type="button"
                onClick={() => (onChangeEraserWidth ? onChangeEraserWidth(size) : onChangeWidth(size))}
                title={`Eraser size: ${size}px`}
                className={`w-7 h-7 rounded-xl flex items-center justify-center transition active:scale-95 ${
                  isSelected
                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 ring-2 ring-rose-500 font-bold'
                    : 'hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-muted-light'
                }`}
              >
                <div
                  className="rounded-full bg-current"
                  style={{ width: `${Math.min(16, Math.max(6, Math.round(size / 3)))}px`, height: `${Math.min(16, Math.max(6, Math.round(size / 3)))}px` }}
                />
              </button>
            );
          })
        ) : (
          // Pen Sizes: Fine (2px), Regular (4px), Medium (7px), Bold (12px)
          [2, 4, 7, 12].map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => onChangeWidth(size)}
              title={`Pen width: ${size}px`}
              className={`w-7 h-7 rounded-xl flex items-center justify-center transition active:scale-95 ${
                width === size
                  ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 font-bold'
                  : 'hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-muted-light'
              }`}
            >
              <div
                className="rounded-full bg-current"
                style={{ width: `${Math.min(14, size + 2)}px`, height: `${Math.min(14, size + 2)}px` }}
              />
            </button>
          ))
        )}
      </div>

      {/* Stylus-Only Palm Shield Toggle */}
      <button
        type="button"
        onClick={onToggleStylusOnly}
        title={isStylusOnly ? "Stylus-Only Active (Palms & fingers completely ignored)" : "All Inputs Active (Click to lock to S Pen / Apple Pencil only)"}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition active:scale-95 ${
          isStylusOnly
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 font-semibold'
            : 'hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-muted-light dark:text-ink-muted-dark'
        }`}
      >
        {isStylusOnly ? <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <ShieldAlert className="w-3.5 h-3.5 opacity-60" />}
        <span className="hidden sm:inline">{isStylusOnly ? 'Stylus Shield' : 'Touch/Pen'}</span>
      </button>

      {/* Scribble to Text Feature Button */}
      <button
        type="button"
        onClick={onScribbleToText}
        disabled={!hasStrokes}
        title="Convert handwritten scribbles to text"
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold shadow-sm transition active:scale-95 ${
          hasStrokes
            ? 'bg-gradient-to-r from-violet-600 via-indigo-600 to-pink-600 text-white hover:opacity-90'
            : 'bg-surface-subtle-light dark:bg-surface-subtle-dark text-ink-muted-light/50 dark:text-ink-muted-dark/50 cursor-not-allowed'
        }`}
      >
        <Wand2 className="w-3.5 h-3.5" />
        <span>Scribble to Text</span>
      </button>

      {/* Undo, Redo, Clear */}
      <div className="flex items-center gap-0.5 pl-1">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo Stroke"
          className="p-1.5 rounded-xl hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          <Undo2 className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo Stroke"
          className="p-1.5 rounded-xl hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          <Redo2 className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onClear}
          disabled={!hasStrokes}
          title="Clear all inking"
          className="p-1.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/30 text-ink-muted-light hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
