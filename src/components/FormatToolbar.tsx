import React, { useState, useRef, useEffect } from 'react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Quote,
  Minus,
  Palette,
  Highlighter,
  RemoveFormatting
} from 'lucide-react';
import { ColorPalette } from './ColorPalette';

interface FormatToolbarProps {
  onApplyFormat: (command: string, value?: string) => void;
}

export const FormatToolbar: React.FC<FormatToolbarProps> = ({ onApplyFormat }) => {
  const [showColorPopover, setShowColorPopover] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowColorPopover(false);
      }
    };
    if (showColorPopover) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showColorPopover]);

  const handleCommand = (e: React.MouseEvent, cmd: string, val: string = '') => {
    e.preventDefault();
    onApplyFormat(cmd, val);
  };

  return (
    <div className="relative flex items-center flex-wrap gap-1 p-1.5 rounded-2xl glass-panel shadow-floating border border-surface-subtle-light dark:border-surface-subtle-dark transition-all">
      {/* Text Style Section */}
      <div className="flex items-center gap-0.5 pr-1.5 border-r border-surface-subtle-light dark:border-surface-subtle-dark">
        <button
          type="button"
          onMouseDown={(e) => handleCommand(e, 'bold')}
          title="Bold (Ctrl+B)"
          className="p-1.5 rounded-xl hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark transition active:scale-95"
        >
          <Bold className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => handleCommand(e, 'italic')}
          title="Italic (Ctrl+I)"
          className="p-1.5 rounded-xl hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark transition active:scale-95"
        >
          <Italic className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => handleCommand(e, 'underline')}
          title="Underline (Ctrl+U)"
          className="p-1.5 rounded-xl hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark transition active:scale-95"
        >
          <Underline className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => handleCommand(e, 'strikeThrough')}
          title="Strikethrough"
          className="p-1.5 rounded-xl hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark transition active:scale-95"
        >
          <Strikethrough className="w-4 h-4" />
        </button>
      </div>

      {/* Headings */}
      <div className="flex items-center gap-0.5 pr-1.5 border-r border-surface-subtle-light dark:border-surface-subtle-dark">
        <button
          type="button"
          onMouseDown={(e) => handleCommand(e, 'formatBlock', '<h1>')}
          title="Large Heading"
          className="p-1.5 rounded-xl hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark transition active:scale-95"
        >
          <Heading1 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => handleCommand(e, 'formatBlock', '<h2>')}
          title="Medium Heading"
          className="p-1.5 rounded-xl hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark transition active:scale-95"
        >
          <Heading2 className="w-4 h-4" />
        </button>
      </div>

      {/* Lists & Blocks */}
      <div className="flex items-center gap-0.5 pr-1.5 border-r border-surface-subtle-light dark:border-surface-subtle-dark">
        <button
          type="button"
          onMouseDown={(e) => handleCommand(e, 'insertUnorderedList')}
          title="Bullet List"
          className="p-1.5 rounded-xl hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark transition active:scale-95"
        >
          <List className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => handleCommand(e, 'insertOrderedList')}
          title="Numbered List"
          className="p-1.5 rounded-xl hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark transition active:scale-95"
        >
          <ListOrdered className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => handleCommand(e, 'formatBlock', '<blockquote>')}
          title="Quote Block"
          className="p-1.5 rounded-xl hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark transition active:scale-95"
        >
          <Quote className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => handleCommand(e, 'insertHorizontalRule')}
          title="Horizontal Divider"
          className="p-1.5 rounded-xl hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark transition active:scale-95"
        >
          <Minus className="w-4 h-4" />
        </button>
      </div>

      {/* Color and Highlighter trigger */}
      <div className="relative" ref={popoverRef}>
        <button
          type="button"
          onClick={() => setShowColorPopover(!showColorPopover)}
          title="Text Color & Highlight Palette"
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium transition active:scale-95 ${
            showColorPopover
              ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
              : 'hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark'
          }`}
        >
          <Palette className="w-4 h-4 text-violet-500" />
          <span>Colors</span>
        </button>

        {showColorPopover && (
          <div className="absolute top-full left-0 mt-2 z-50">
            <ColorPalette
              onSelectTextColor={(color) => {
                onApplyFormat('foreColor', color);
                setShowColorPopover(false);
              }}
              onSelectHighlightColor={(color) => {
                onApplyFormat('hiliteColor', color);
                setShowColorPopover(false);
              }}
            />
          </div>
        )}
      </div>

      {/* Clear Formatting */}
      <button
        type="button"
        onMouseDown={(e) => handleCommand(e, 'removeFormat')}
        title="Clear Formatting"
        className="p-1.5 rounded-xl hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-light transition active:scale-95 ml-1"
      >
        <RemoveFormatting className="w-4 h-4" />
      </button>
    </div>
  );
};
