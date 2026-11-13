import React, { useRef, useEffect, useMemo } from 'react';
import { Note } from '../types/note';
import { FormatToolbar } from './FormatToolbar';

interface TextEditorProps {
  note: Note;
  onChangeContent: (content: string) => void;
}

/**
 * Extracts readable text from note HTML. Works on a detached node, so it is
 * safe to call during render (unlike innerText, which needs layout).
 */
function htmlToText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  div.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  div
    .querySelectorAll('p, div, li, ul, ol, h1, h2, h3, h4, h5, h6, blockquote')
    .forEach((block) => block.append('\n'));
  return div.textContent || '';
}

/**
 * Chrome materialises the editor's inherited theme colours as inline styles
 * while reshaping blocks for a list command. Those baked colours survive a
 * light/dark switch and leave unreadable text, so drop them, and discard the
 * wrappers they leave behind. Child text nodes are kept, so the caret survives.
 */
function cleanListMarkup(root: HTMLElement) {
  root.querySelectorAll('[style]').forEach((el) => {
    const declarations = (el.getAttribute('style') || '')
      .split(';')
      .map((declaration) => declaration.trim())
      .filter(
        (declaration) =>
          declaration &&
          !declaration.includes('var(--tw-') &&
          !/^font-size\s*:/i.test(declaration)
      );

    if (declarations.length > 0) {
      el.setAttribute('style', declarations.join('; '));
    } else {
      el.removeAttribute('style');
    }

    if (el.tagName === 'SPAN' && el.attributes.length === 0) {
      el.replaceWith(...Array.from(el.childNodes));
    }
  });

  // execCommand nests a converted paragraph: <p><ul>…</ul></p> is invalid markup
  root.querySelectorAll('p > ul, p > ol').forEach((list) => {
    const parent = list.parentElement;
    if (parent && parent.children.length === 1) {
      parent.replaceWith(list);
    }
  });

  // An indented level is inserted as a sibling of the item: ul > ul is invalid
  root.querySelectorAll('ul > ul, ul > ol, ol > ul, ol > ol').forEach((list) => {
    const previous = list.previousElementSibling;
    if (previous && previous.tagName === 'LI') {
      previous.appendChild(list);
    }
  });
}

export const TextEditor: React.FC<TextEditorProps> = ({ note, onChangeContent }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalUpdateRef = useRef(false);

  // Synchronize content whenever external note or content changes
  useEffect(() => {
    if (editorRef.current) {
      if (isInternalUpdateRef.current) {
        // Change originated from user typing in this editor instance;
        // consume the flag and don't re-render innerHTML to preserve cursor.
        isInternalUpdateRef.current = false;
        return;
      }
      // External change (e.g. note switched, or OCR Scribble text inserted)
      if (editorRef.current.innerHTML !== note.content) {
        editorRef.current.innerHTML = note.content;
      }
    }
  }, [note.id, note.content]);

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
      if (command === 'insertUnorderedList' || command === 'insertOrderedList') {
        cleanListMarkup(editorRef.current);
      }
      handleInput();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    handleInput();
  };

  // Tab indents a list item instead of moving focus out of the note.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;

    const anchor = window.getSelection()?.anchorNode;
    const editor = editorRef.current;
    if (!anchor || !editor || !editor.contains(anchor)) return;

    const element = anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement;
    const listItem = element?.closest('li');
    if (!listItem || !editor.contains(listItem)) return;

    e.preventDefault();
    editor.focus();
    document.execCommand(e.shiftKey ? 'outdent' : 'indent', false, undefined);
    cleanListMarkup(editor);
    handleInput();
  };

  // Calculate words and characters from the note content so the counts are
  // correct on first paint (the contentEditable DOM is populated after mount).
  const stats = useMemo(() => {
    const text = htmlToText(note.content);
    const trimmed = text.trim();
    return {
      words: trimmed ? trimmed.split(/\s+/).length : 0,
      chars: trimmed.length
    };
  }, [note.content]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-surface-light dark:bg-surface-dark relative">
      {/* Floating / Sticky Formatting Toolbar */}
      <div className="p-3 border-b border-surface-subtle-light dark:border-surface-subtle-dark flex items-center justify-center bg-surface-light/60 dark:bg-surface-dark/60 backdrop-blur-md sticky top-0 z-10">
        <FormatToolbar onApplyFormat={handleFormat} />
      </div>

      {/* Main editable note sheet */}
      <div className="flex-1 overflow-y-auto px-6 py-8 md:px-12 lg:px-16 md:py-12 flex justify-center">
        <div className="w-full max-w-4xl xl:max-w-5xl min-h-[500px] transition-all duration-300">
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={handleInput}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
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
