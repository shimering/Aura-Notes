import React, { useState } from 'react';
import { 
  Pen, 
  Feather, 
  Highlighter, 
  Eraser, 
  ChevronDown,
  Undo2, 
  Redo2, 
  Trash2, 
  Wand2,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  LayoutTemplate,
  AlignJustify,
  Grid3x3,
  Circle,
  Square
} from 'lucide-react';
import { PenTool, InkBackground, EraserMode } from '../types/note';
import { INK_BACKGROUNDS } from '../utils/inkBackground';

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
  eraserMode?: EraserMode;
  onChangeEraserMode?: (mode: EraserMode) => void;
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
  lastWritingTool?: PenTool;
  background?: InkBackground;
  onChangeBackground?: (background: InkBackground) => void;
}

const BACKGROUND_ICONS: Record<InkBackground, React.ReactNode> = {
  none: <Square className="w-3.5 h-3.5" />,
  ruled: <AlignJustify className="w-3.5 h-3.5" />,
  grid: <Grid3x3 className="w-3.5 h-3.5" />,
  dotted: <Circle className="w-3.5 h-3.5" />
};

const ERASER_MODES: {
  id: EraserMode;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    id: 'object',
    label: 'Object',
    description: 'Object eraser — remove each touched stroke completely',
    icon: <Trash2 className="w-3.5 h-3.5" />
  },
  {
    id: 'pixel',
    label: 'Pixel',
    description: 'Pixel eraser — erase only the covered part of a stroke',
    icon: <Eraser className="w-3.5 h-3.5" />
  }
];

export const PenToolbar: React.FC<PenToolbarProps> = ({
  activeTool,
  onSelectTool,
  color,
  onChangeColor,
  width,
  onChangeWidth,
  eraserWidth,
  onChangeEraserWidth,
  eraserMode = 'object',
  onChangeEraserMode,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  onScribbleToText,
  hasStrokes,
  isStylusOnly,
  onToggleStylusOnly,
  onOpenSPenMenu,
  lastWritingTool,
  background = 'none',
  onChangeBackground
}) => {
  const [isEraserMenuOpen, setIsEraserMenuOpen] = useState<boolean>(false);
  const [isBackgroundMenuOpen, setIsBackgroundMenuOpen] = useState<boolean>(false);
  const currentPalette = activeTool === 'highlighter' ? HIGHLIGHTER_PALETTE : INK_PALETTE;

  return (
    <div
      data-ink-ui="pen-toolbar"
      className="flex items-center flex-wrap gap-1.5 p-2 rounded-2xl glass-panel shadow-floating border border-surface-subtle-light dark:border-surface-subtle-dark select-none"
    >
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

        {/* Eraser Tool + Quick Size Popover Trigger */}
        <div className="relative flex items-center">
          <button
            type="button"
            onClick={() => {
              if (activeTool === 'eraser') {
                onSelectTool(lastWritingTool || 'fountain');
              } else {
                onSelectTool('eraser');
              }
            }}
            title={activeTool === 'eraser' ? `Eraser Active — ${eraserMode === 'pixel' ? 'Pixel' : 'Object'} mode (Click to return to pen)` : "Eraser (or hold S Pen side button to erase momentarily)"}
            className={`p-2 rounded-xl transition active:scale-95 flex items-center justify-center ${
              activeTool === 'eraser'
                ? 'bg-rose-500 text-white shadow-md ring-2 ring-rose-400'
                : 'hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark'
            }`}
          >
            <Eraser className="w-4 h-4" />
          </button>

          {/* Dedicated Eraser Size Button (Always accessible without changing active pen!) */}
          <button
            type="button"
            onClick={() => setIsEraserMenuOpen(!isEraserMenuOpen)}
            title="Choose Eraser Size & Mode (also used by S Pen button)"
            className={`ml-1 text-[11px] font-semibold px-1.5 py-1 rounded-lg flex items-center gap-1 whitespace-nowrap transition active:scale-95 ${
              activeTool === 'eraser'
                ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-200'
                : 'bg-surface-subtle-light dark:bg-surface-subtle-dark text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-light dark:hover:text-ink-dark'
            }`}
          >
            <span>{eraserMode === 'pixel' ? 'Pixel' : 'Object'}</span>
            <span className="opacity-50">·</span>
            <span>{eraserWidth ?? 24}px</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {/* Eraser Size Popover */}
          {isEraserMenuOpen && (
            <div className="absolute top-full mt-2 left-0 z-50 p-2.5 rounded-2xl glass-panel shadow-floating border border-surface-subtle-light dark:border-surface-subtle-dark bg-surface-light dark:bg-surface-dark flex flex-col gap-1.5 min-w-[240px] animate-in fade-in slide-in-from-top-1">
              <div className="flex items-center justify-between px-1 text-[11px] font-bold text-ink-light dark:text-ink-dark">
                <span className="flex items-center gap-1.5">
                  <Eraser className="w-3.5 h-3.5 text-rose-500" />
                  Eraser Settings
                </span>
                <span className="text-[10px] text-ink-muted-light dark:text-ink-muted-dark font-normal">
                  S Pen Button
                </span>
              </div>

              {/* Eraser Mode */}
              <div className="grid grid-cols-2 gap-1 pt-1">
                {ERASER_MODES.map((mode) => {
                  const isSelected = eraserMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => onChangeEraserMode?.(mode.id)}
                      title={mode.description}
                      className={`px-2 py-1.5 rounded-xl flex items-center justify-center gap-1.5 text-[11px] transition active:scale-95 ${
                        isSelected
                          ? 'bg-rose-500 text-white shadow-md font-semibold'
                          : 'hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark'
                      }`}
                    >
                      {mode.icon}
                      <span>{mode.label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="px-1 text-[10px] leading-snug text-ink-muted-light dark:text-ink-muted-dark">
                {eraserMode === 'pixel'
                  ? 'Erases only the covered part of a stroke.'
                  : 'Removes each touched stroke completely.'}
              </p>

              {/* Eraser Size */}
              <div className="mt-1 pt-2 border-t border-surface-subtle-light dark:border-surface-subtle-dark">
                <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted-light dark:text-ink-muted-dark">
                  Size
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {[
                    { size: 12, label: '12px' },
                    { size: 24, label: '24px' },
                    { size: 36, label: '36px' },
                    { size: 56, label: '56px' }
                  ].map((item) => {
                    const isSel = (eraserWidth ?? 24) === item.size;
                    return (
                      <button
                        key={item.size}
                        type="button"
                        onClick={() => {
                          onChangeEraserWidth?.(item.size);
                          setIsEraserMenuOpen(false);
                        }}
                        className={`py-2 px-1 rounded-xl flex flex-col items-center justify-center gap-1 transition active:scale-95 ${
                          isSel
                            ? 'bg-rose-500 text-white shadow-md font-bold'
                            : 'hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark'
                        }`}
                      >
                        <div 
                          className="rounded-full bg-current" 
                          style={{ width: `${Math.min(16, Math.max(6, Math.round(item.size / 3.5)))}px`, height: `${Math.min(16, Math.max(6, Math.round(item.size / 3.5)))}px` }} 
                        />
                        <span className="text-[10px]">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {onOpenSPenMenu && (
          <button
            type="button"
            onClick={onOpenSPenMenu}
            title="S Pen Quick Menu"
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
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-rose-600 dark:text-rose-400 mr-0.5">
              Eraser:
            </span>
            <div className="flex items-center p-0.5 rounded-lg bg-surface-subtle-light dark:bg-surface-subtle-dark">
              {ERASER_MODES.map((mode) => {
                const isSelected = eraserMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => onChangeEraserMode?.(mode.id)}
                    title={mode.description}
                    aria-pressed={isSelected}
                    className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold transition active:scale-95 ${
                      isSelected
                        ? 'bg-rose-500 text-white shadow-sm'
                        : 'text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-light dark:hover:text-ink-dark'
                    }`}
                  >
                    {mode.label}
                  </button>
                );
              })}
            </div>
            {[12, 24, 36, 56].map((size) => {
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
                      ? 'bg-rose-500 text-white ring-2 ring-rose-400 font-bold shadow-sm'
                      : 'hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-muted-light'
                  }`}
                >
                  <div
                    className="rounded-full bg-current"
                    style={{ width: `${Math.min(16, Math.max(6, Math.round(size / 3)))}px`, height: `${Math.min(16, Math.max(6, Math.round(size / 3)))}px` }}
                  />
                </button>
              );
            })}
            {/* Direct Back to Pen Button when Eraser is active */}
            <button
              type="button"
              onClick={() => onSelectTool(lastWritingTool || 'fountain')}
              title="Return to writing pen"
              className="ml-1 flex items-center gap-1 px-2.5 py-1 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium shadow-sm transition active:scale-95"
            >
              <Feather className="w-3.5 h-3.5" />
              <span>Back to Pen</span>
            </button>
          </div>
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
                  ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 font-bold ring-2 ring-violet-500'
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

      {/* Page Background Picker */}
      {onChangeBackground && (
        <div className="relative flex items-center pr-1 border-r border-surface-subtle-light dark:border-surface-subtle-dark">
          <button
            type="button"
            onClick={() => setIsBackgroundMenuOpen(!isBackgroundMenuOpen)}
            title="Page background style"
            className={`flex items-center gap-1 px-2 py-1.5 rounded-xl text-xs font-medium transition active:scale-95 ${
              background !== 'none'
                ? 'bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300 font-semibold'
                : 'hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-muted-light dark:text-ink-muted-dark'
            }`}
          >
            <LayoutTemplate className="w-4 h-4" />
            <span className="hidden sm:inline">Page</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {isBackgroundMenuOpen && (
            <div className="absolute top-full mt-2 right-0 z-50 p-2.5 rounded-2xl glass-panel shadow-floating border border-surface-subtle-light dark:border-surface-subtle-dark bg-surface-light dark:bg-surface-dark flex flex-col gap-1.5 min-w-[190px] animate-in fade-in slide-in-from-top-1">
              <div className="px-1 text-[11px] font-bold text-ink-light dark:text-ink-dark flex items-center gap-1.5">
                <LayoutTemplate className="w-3.5 h-3.5 text-violet-500" />
                Page Background
              </div>
              <div className="grid grid-cols-2 gap-1 pt-1">
                {INK_BACKGROUNDS.map((item) => {
                  const isSelected = background === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onChangeBackground(item.id);
                        setIsBackgroundMenuOpen(false);
                      }}
                      className={`px-2 py-2 rounded-xl flex items-center gap-2 text-xs transition active:scale-95 ${
                        isSelected
                          ? 'bg-violet-600 text-white shadow-md font-semibold'
                          : 'hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark'
                      }`}
                    >
                      {BACKGROUND_ICONS[item.id]}
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

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
