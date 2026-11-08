import React, { useRef, useEffect } from 'react';
import { Note } from '../types/note';
import { FormatToolbar } from './FormatToolbar';

interface TextEditorProps {
  note: Note;
  onChangeContent: (content: string) => void;
}

export const TextEditor: React.FC<TextEditorProps> = ({ note, onChangeContent }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalUpdateRef = useRef(false);

  // Sync content only if external note changed (not when user is typing)
  useEffect(() => {
    if (editorRef.current && !isInternalUpdateRef.current) {
      if (editorRef.current.innerHTML !== note.content) {
        editorRef.current.innerHTML = note.content;
      }
    }
    isInternalUpdateRef.current = false;
  }, [note.id]);

  const handleInput = () => {
    if (editorRef.current) {
      isInternalUpdateRef.current = true;
      onChangeContent(editorRef.current.innerHTML);
    }
  };

  const handleFormat = (command: string, value: string = '') => {
    if (editorRef.current) {
      editorRef.current.focus();
      document.execCommand(command, false, value);
      handleInput();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    handleInput();
  };

  // Calculate words and characters
  const getStats = () => {
    if (!editorRef.current) return { words: 0, chars: 0 };
    const text = editorRef.current.innerText || '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    return { words, chars };
  };

  const stats = getStats();

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-surface-light dark:bg-surface-dark relative">
      {/* Floating / Sticky Formatting Toolbar */}
      <div className="p-3 border-b border-surface-subtle-light dark:border-surface-subtle-dark flex items-center justify-center bg-surface-light/60 dark:bg-surface-dark/60 backdrop-blur-md sticky top-0 z-10">
        <FormatToolbar onApplyFormat={handleFormat} />
      </div>

      {/* Main editable note sheet */}
      <div className="flex-1 overflow-y-auto px-6 py-8 md:px-16 md:py-12 flex justify-center">
        <div className="w-full max-w-3xl min-h-[500px]">
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={handleInput}
            onPaste={handlePaste}
            data-placeholder="Start typing your thoughts here, or use the stylus canvas to write by hand..."
            className="editable-note-content min-h-[400px] text-base md:text-lg text-ink-light dark:text-ink-dark leading-relaxed outline-none focus:outline-none font-sans"
            style={{
              wordBreak: 'break-word',
              overflowWrap: 'break-word'
            }}
          />
        </div>
      </div>

      {/* Editor Footer Stats */}
      <div className="h-8 border-t border-surface-subtle-light dark:border-surface-subtle-dark px-6 flex items-center justify-between text-xs text-ink-muted-light dark:text-ink-muted-dark bg-surface-subtle-light/40 dark:bg-surface-subtle-dark/40 select-none">
        <span>S Pen &amp; Apple Pencil Scribble enabled</span>
        <div className="flex items-center gap-4">
          <span>{stats.words} words</span>
          <span>{stats.chars} characters</span>
        </div>
      </div>
    </div>
  );
};
