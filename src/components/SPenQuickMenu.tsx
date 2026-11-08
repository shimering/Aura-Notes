import React, { useEffect, useRef } from 'react';
import { 
  PenTool as PenToolType 
} from '../types/note';
import { 
  Feather, 
  Pen, 
  Highlighter, 
  Eraser, 
  X, 
  Sparkles,
  Check
} from 'lucide-react';
import { INK_PALETTE, HIGHLIGHTER_PALETTE } from './PenToolbar';

interface SPenQuickMenuProps {
  isOpen: boolean;
  onClose: () => void;
  position: { x: number; y: number } | null;
  activeTool: PenToolType;
  onSelectTool: (tool: PenToolType) => void;
  color: string;
  onChangeColor: (color: string) => void;
  width: number;
  onChangeWidth: (width: number) => void;
}

export const SPenQuickMenu: React.FC<SPenQuickMenuProps> = ({
  isOpen,
  onClose,
  position,
  activeTool,
  onSelectTool,
  color,
  onChangeColor,
  width,
  onChangeWidth
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close when tapping outside or pressing escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const handlePointerDownOutside = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', handlePointerDownOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', handlePointerDownOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Calculate coordinates clamped to viewport
  const getMenuStyle = () => {
    const menuWidth = 320;
    const menuHeight = 360;
    const padding = 16;

    if (!position) {
      // Default center-right
      return {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };
    }

    let left = position.x + 15;
    let top = position.y - 40;

    // Boundary checks
    if (left + menuWidth > window.innerWidth - padding) {
      left = position.x - menuWidth - 15;
    }
    if (left < padding) {
      left = padding;
    }

    if (top + menuHeight > window.innerHeight - padding) {
      top = window.innerHeight - menuHeight - padding;
    }
    if (top < padding) {
      top = padding;
    }

    return {
      top: `${top}px`,
      left: `${left}px`,
    };
  };

  const tools: { id: PenToolType; label: string; icon: React.ReactNode; desc: string }[] = [
    { id: 'fountain', label: 'Fountain', icon: <Feather className="w-4 h-4" />, desc: 'Calligraphic & pressure' },
    { id: 'pen', label: 'Ballpoint', icon: <Pen className="w-4 h-4" />, desc: 'Smooth & precise' },
    { id: 'highlighter', label: 'Highlighter', icon: <Highlighter className="w-4 h-4" />, desc: 'Soft transparent ink' },
    { id: 'eraser', label: 'Eraser', icon: <Eraser className="w-4 h-4" />, desc: 'Precise stroke removal' },
  ];

  const currentColors = activeTool === 'highlighter' ? HIGHLIGHTER_PALETTE : INK_PALETTE;

  return (
    <div 
      className="fixed inset-0 z-50 pointer-events-none"
    >
      <div
        ref={menuRef}
        style={getMenuStyle()}
        className="fixed pointer-events-auto w-80 rounded-3xl bg-surface-light/95 dark:bg-surface-dark/95 backdrop-blur-2xl border border-surface-subtle-light/80 dark:border-surface-subtle-dark/80 shadow-2xl p-4 animate-in fade-in zoom-in-95 duration-150 select-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-surface-subtle-light dark:border-surface-subtle-dark">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-600 flex items-center justify-center text-white shadow-sm">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-ink-light dark:text-ink-dark tracking-tight">
                S Pen Quick Palette
              </h4>
              <p className="text-[10px] text-ink-muted-light dark:text-ink-muted-dark">
                Hold button to erase • Tap to toggle
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-ink-muted-light hover:text-ink-light dark:text-ink-muted-dark dark:hover:text-ink-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 1. Pen Tools Grid */}
        <div className="my-3">
          <span className="text-[10px] font-semibold text-ink-muted-light dark:text-ink-muted-dark uppercase tracking-wider block mb-1.5">
            Pen Type
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {tools.map((t) => {
              const isActive = activeTool === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => onSelectTool(t.id)}
                  className={`flex items-center gap-2 p-2 rounded-2xl text-left transition active:scale-95 ${
                    isActive
                      ? 'bg-violet-600 text-white shadow-sm font-semibold'
                      : 'bg-surface-subtle-light/60 dark:bg-surface-subtle-dark/60 text-ink-light dark:text-ink-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark'
                  }`}
                >
                  <div className={`p-1.5 rounded-xl ${isActive ? 'bg-white/20' : 'bg-black/5 dark:bg-white/10'}`}>
                    {t.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs truncate leading-tight">{t.label}</p>
                    <p className={`text-[9px] truncate ${isActive ? 'text-violet-100' : 'text-ink-muted-light dark:text-ink-muted-dark'}`}>
                      {t.desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. Color Selection (only when not eraser) */}
        {activeTool !== 'eraser' && (
          <div className="my-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold text-ink-muted-light dark:text-ink-muted-dark uppercase tracking-wider">
                Color
              </span>
              <span className="text-[10px] font-mono text-ink-muted-light dark:text-ink-muted-dark uppercase">
                {color}
              </span>
            </div>
            <div className="flex items-center flex-wrap gap-2">
              {currentColors.map((c) => {
                const isSelected = color.toLowerCase() === c.hex.toLowerCase();
                return (
                  <button
                    key={c.hex}
                    onClick={() => onChangeColor(c.hex)}
                    title={c.name}
                    className={`w-7 h-7 rounded-full border transition active:scale-90 relative flex items-center justify-center ${
                      isSelected
                        ? 'ring-2 ring-violet-500 ring-offset-2 ring-offset-white dark:ring-offset-gray-900 scale-110 shadow-sm'
                        : 'border-black/10 dark:border-white/10 opacity-80 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: c.hex }}
                  >
                    {isSelected && (
                      <Check 
                        className={`w-3.5 h-3.5 ${
                          c.hex === '#ffffff' || c.hex === '#e2e8f0' || c.hex === '#fef08a' 
                            ? 'text-gray-900' 
                            : 'text-white'
                        }`} 
                      />
                    )}
                  </button>
                );
              })}
              {/* Custom Color Input */}
              <label 
                title="Pick Custom Color"
                className="w-7 h-7 rounded-full border border-dashed border-violet-400 dark:border-violet-600 flex items-center justify-center cursor-pointer hover:scale-105 transition"
              >
                <input
                  type="color"
                  value={color}
                  onChange={(e) => onChangeColor(e.target.value)}
                  className="w-0 h-0 opacity-0 absolute"
                />
                <span className="text-xs font-bold text-violet-600 dark:text-violet-400">+</span>
              </label>
            </div>
          </div>
        )}

        {/* 3. Stroke Thickness */}
        <div className="mt-3 pt-3 border-t border-surface-subtle-light dark:border-surface-subtle-dark">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-ink-muted-light dark:text-ink-muted-dark uppercase tracking-wider">
              Thickness ({width}px)
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {[2, 4, 7, 12].map((size) => {
              const isSelected = width === size;
              return (
                <button
                  key={size}
                  onClick={() => onChangeWidth(size)}
                  className={`py-1.5 px-2 rounded-xl flex items-center justify-center gap-1.5 transition active:scale-95 ${
                    isSelected
                      ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 font-bold'
                      : 'bg-surface-subtle-light/60 dark:bg-surface-subtle-dark/60 text-ink-muted-light hover:text-ink-light'
                  }`}
                >
                  <div 
                    className="rounded-full bg-current" 
                    style={{ width: `${Math.min(12, size + 2)}px`, height: `${Math.min(12, size + 2)}px` }} 
                  />
                  <span className="text-[11px]">{size}px</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
