import React, { forwardRef, useImperativeHandle, useRef, useEffect, useMemo } from 'react';
import { Note } from '../types/note';
import { FormatToolbar } from './FormatToolbar';
import { pdfData, sanitizeNoteHtml } from '../utils/noteHtml';
import type { Point } from '../utils/inkSelection';
import { placePicture } from '../utils/pageObjects';

export interface TextEditorRef {
  focusEditor: () => void;
  focusAt: (point: Point) => void;
  savePageObjects: () => void;
  dropPictures: (files: File[], point: Point) => Promise<HTMLImageElement[]>;
  applyFormat: (command: string, value?: string) => Promise<void>;
  insertTable: (rows: number, columns: number) => void;
  insertFile: (file: File, kind: 'picture' | 'pdf') => Promise<void>;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_NOTE_BYTES = 10 * 1024 * 1024;
const pictureType = /^image\/(?:png|jpeg|gif|webp|avif|bmp)$/i;

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

interface TextEditorProps {
  note: Note;
  onChangeContent: (content: string) => void;
  /** Bumped when the Text tool (or a finger tap) hands the caret to the sheet. */
  focusRequest?: number;
  /** Renders only the editable sheet: the unified note page supplies the toolbar. */
  embedded?: boolean;
  /** Whether the sheet accepts typing; false while a pen or select tool is active. */
  editable?: boolean;
}

/**
 * Extracts readable text from note HTML. Works on a detached node, so it is
 * safe to call during render (unlike innerText, which needs layout).
 */
function htmlToText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = sanitizeNoteHtml(html || '');
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
          !declaration.includes('var(--tw-')
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

export const TextEditor = forwardRef<TextEditorRef, TextEditorProps>((
  { note, onChangeContent, focusRequest = 0, embedded = false, editable = true },
  ref
) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const internalUpdateRef = useRef<{ noteId: string; content: string } | null>(null);
  const savedRange = useRef<Range | null>(null);
  const emptyWritingBlock = useRef<HTMLDivElement | null>(null);
  const latestNote = useRef(note);
  if (latestNote.current.id !== note.id) savedRange.current = null;
  latestNote.current = note;

  useEffect(() => {
    const rememberSelection = () => {
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (editorRef.current?.contains(range.commonAncestorContainer)) {
        savedRange.current = range.cloneRange();
      }
    };
    document.addEventListener('selectionchange', rememberSelection);
    return () => document.removeEventListener('selectionchange', rememberSelection);
  }, []);

  // Synchronize content whenever external note or content changes
  useEffect(() => {
    if (editorRef.current) {
      const internalUpdate = internalUpdateRef.current;
      internalUpdateRef.current = null;
      if (internalUpdate?.noteId === note.id && internalUpdate.content === note.content) {
        // Change originated from user typing in this editor instance;
        // consume the flag and don't re-render innerHTML to preserve cursor.
        return;
      }
      // External change (e.g. note switched, or OCR Scribble text inserted)
      const content = sanitizeNoteHtml(note.content);
      if (editorRef.current.innerHTML !== content) {
        savedRange.current = null;
        editorRef.current.innerHTML = content;
      }
    }
  }, [note.id, note.content]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const objects = Array.from(editor.querySelectorAll<HTMLElement>(
      ':scope > [data-note-positioned], :scope > img[data-picture-wrap="free"]',
    ));
    const fitContent = () => {
      const bottom = objects.reduce((max, object) => Math.max(max, object.offsetTop + object.offsetHeight), 0);
      editor.style.minHeight = bottom > 400 ? `${bottom}px` : '';
    };
    fitContent();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fitContent);
    objects.forEach((object) => observer.observe(object));
    return () => observer.disconnect();
  }, [note.id, note.content]);

  // A single finger tap on the Draw surface hands the sheet the caret, so the
  // on-screen keyboard has somewhere to type straight away.
  useEffect(() => {
    if (!focusRequest) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }, [focusRequest]);

  const getEditorRange = (editor: HTMLElement) => {
    const selection = window.getSelection();
    const current = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (current && editor.contains(current.commonAncestorContainer)) return current.cloneRange();
    if (savedRange.current && editor.contains(savedRange.current.commonAncestorContainer)) {
      return savedRange.current.cloneRange();
    }
    const end = document.createRange();
    end.selectNodeContents(editor);
    end.collapse(false);
    return end;
  };

  const focusRange = (editor: HTMLElement, range: Range) => {
    editor.focus({ preventScroll: true });
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const handleInput = () => {
    if (editorRef.current) {
      const content = sanitizeNoteHtml(editorRef.current.innerHTML);
      internalUpdateRef.current = { noteId: note.id, content };
      onChangeContent(content);
    }
  };

  const discardEmptyWritingBlock = () => {
    const block = emptyWritingBlock.current;
    if (block && !block.textContent && !block.querySelector('img, a, table')) block.remove();
    emptyWritingBlock.current = null;
  };

  const focusAt = (point: Point) => {
    const editor = editorRef.current;
    if (!editor) return;
    discardEmptyWritingBlock();
    const block = document.createElement('div');
    block.dataset.notePositioned = 'true';
    block.style.left = `${Math.round(Math.max(0, Math.min(editor.clientWidth - 48, point.x)))}px`;
    block.style.top = `${Math.round(Math.max(0, point.y))}px`;
    const paragraph = document.createElement('p');
    paragraph.append(document.createElement('br'));
    block.append(paragraph);
    editor.append(block);
    emptyWritingBlock.current = block;
    const range = document.createRange();
    range.setStart(paragraph, 0);
    range.collapse(true);
    focusRange(editor, range);
  };

  const dropPictures = async (files: File[], point: Point) => {
    const editor = editorRef.current;
    if (!editor) return [];
    const noteId = latestNote.current.id;
    if (files.some((file) => !pictureType.test(file.type))) {
      throw new Error('Drop a PNG, JPEG, GIF, WebP, AVIF or BMP picture.');
    }
    if (files.some((file) => !file.size || file.size > MAX_FILE_BYTES)) {
      throw new Error('Each picture must be between 1 byte and 5 MB.');
    }
    if (files.reduce((bytes, file) => bytes + file.size, 0) * 4 / 3 > MAX_NOTE_BYTES) {
      throw new Error('These pictures would take the note above the 10 MB sync limit.');
    }
    const images = await Promise.all(files.map(async (file, index) => {
      const image = document.createElement('img');
      image.src = await readDataUrl(file);
      image.alt = file.name;
      const width = Math.max(48, Math.min(280, editor.clientWidth - point.x));
      placePicture(image, { x: point.x + index * 16, y: point.y + index * 16 }, width);
      return image;
    }));
    if (editor !== editorRef.current || noteId !== latestNote.current.id) return [];
    const content = sanitizeNoteHtml(editor.innerHTML) + images.map((image) => image.outerHTML).join('');
    if (new Blob([JSON.stringify({ ...latestNote.current, content })]).size > MAX_NOTE_BYTES) {
      throw new Error('These pictures would take the note above the 10 MB sync limit.');
    }
    editor.append(...images);
    handleInput();
    return images;
  };

  const handleFormat = async (command: string, value: string = '') => {
    const editor = editorRef.current;
    if (!editor?.isContentEditable) return;
    const range = getEditorRange(editor);
    const noteId = note.id;
    if (command === 'paste') {
      if (!navigator.clipboard?.readText) throw new Error('Use Ctrl+V or your device’s Paste command.');
      try {
        value = await navigator.clipboard.readText();
      } catch {
        throw new Error('Clipboard access was blocked. Use Ctrl+V or your device’s Paste command.');
      }
      if (editorRef.current !== editor || latestNote.current.id !== noteId ||
        !editor.isContentEditable || !editor.contains(range.commonAncestorContainer)) return;
      command = 'insertText';
    }
    focusRange(editor, range);
    const applied = document.execCommand(command, false, value);
    if (!applied && (command === 'copy' || command === 'cut')) {
      throw new Error(command === 'copy' ? 'Select text and use Ctrl+C to copy.' : 'Select text and use Ctrl+X to cut.');
    }
    if (['insertUnorderedList', 'insertOrderedList', 'indent', 'outdent'].includes(command)) {
      cleanListMarkup(editor);
    }
    handleInput();
  };

  const insertMarkup = (editor: HTMLDivElement, range: Range, markup: string) => {
    focusRange(editor, range);
    if (!document.execCommand('insertHTML', false, markup)) {
      throw new Error('Could not insert content. Place the cursor on the page and try again.');
    }
    handleInput();
  };

  const insertFile = async (file: File, kind: 'picture' | 'pdf') => {
    const editor = editorRef.current;
    if (!editor) return;
    const range = getEditorRange(editor);
    const content = latestNote.current.content;
    const noteId = note.id;
    if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('Choose a file between 1 byte and 5 MB.');
    if (kind === 'picture' && !pictureType.test(file.type)) {
      throw new Error('Choose a PNG, JPEG, GIF, WebP, AVIF or BMP picture.');
    }
    if (kind === 'pdf' && !(await file.slice(0, 5).text()).startsWith('%PDF-')) {
      throw new Error('The selected file is not a PDF.');
    }

    const data = await readDataUrl(file);
    if (editorRef.current !== editor || latestNote.current.id !== noteId) return;
    if (!editor.isContentEditable) throw new Error('Switch to the Text tool before inserting a file.');
    const element = document.createElement(kind === 'picture' ? 'img' : 'a');
    if (element instanceof HTMLImageElement) {
      element.src = data;
      element.alt = file.name;
    } else {
      element.href = data.replace(/^data:[^,]*,/, 'data:application/pdf;base64,');
      element.download = file.name;
      element.textContent = file.name;
    }
    const markup = `<p>${element.outerHTML}</p><p><br></p>`;
    const noteBytes = new Blob([JSON.stringify({
      ...latestNote.current,
      content: sanitizeNoteHtml(editor.innerHTML) + markup,
    })]).size;
    if (noteBytes > MAX_NOTE_BYTES) throw new Error('This file would take the note above the 10 MB sync limit.');
    const target = latestNote.current.content === content && editor.contains(range.commonAncestorContainer)
      ? range
      : getEditorRange(editor);
    insertMarkup(editor, target, markup);
  };

  // The unified page's toolbar drives formatting through this handle.
  useImperativeHandle(ref, () => ({
    focusEditor: () => {
      const editor = editorRef.current;
      if (editor) focusRange(editor, getEditorRange(editor));
    },
    focusAt,
    savePageObjects: handleInput,
    dropPictures,
    applyFormat: handleFormat,
    insertTable: (rows, columns) => {
      const editor = editorRef.current;
      if (!editor) return;
      const row = `<tr>${'<td><br></td>'.repeat(columns)}</tr>`;
      insertMarkup(editor, getEditorRange(editor), `<table><tbody>${row.repeat(rows)}</tbody></table><p><br></p>`);
    },
    insertFile,
  }));

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
    const cell = element?.closest<HTMLTableCellElement>('td, th');
    if (cell) {
      const cells = Array.from(cell.closest('table')?.querySelectorAll('td, th') ?? []);
      const next = cells[cells.indexOf(cell) + (e.shiftKey ? -1 : 1)];
      if (next) {
        e.preventDefault();
        const range = document.createRange();
        range.selectNodeContents(next);
        focusRange(editor, range);
      }
      return;
    }

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

  const sheet = (
    <div
      ref={editorRef}
      contentEditable={embedded ? editable : true}
      suppressContentEditableWarning
      onInput={handleInput}
      onBlur={discardEmptyWritingBlock}
      onDragStart={(event) => {
        if (event.target instanceof HTMLImageElement) event.preventDefault();
      }}
      onPaste={handlePaste}
      onClick={(event) => {
        if (!(event.target instanceof Element)) return;
        const attachment = event.target.closest<HTMLAnchorElement>('a[download]');
        if (!attachment || !pdfData.test(attachment.getAttribute('href') ?? '')) return;
        event.preventDefault();
        const link = document.createElement('a');
        link.href = attachment.href;
        link.download = attachment.download;
        link.click();
      }}
      onDrop={(event) => event.preventDefault()}
      onKeyDown={handleKeyDown}
      data-note-editor="true"
      data-placeholder="Start typing on the page, or draw anywhere with the pen..."
      className="editable-note-content min-h-[400px] text-base md:text-lg text-ink-light dark:text-ink-dark leading-relaxed outline-none focus:outline-none font-sans"
      style={{
        wordBreak: 'break-word',
        overflowWrap: 'break-word'
      }}
    />
  );

  // Editor chrome sits outside the sheet so the unified page owns the layout.
  if (embedded) {
    return (
      <div className="relative" data-note-surface="text">
        <div className="w-full max-w-4xl mx-auto px-6 py-8 md:px-10 md:py-10">{sheet}</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-surface-light dark:bg-surface-dark relative">
      {/* Floating / Sticky Formatting Toolbar */}
      <div className="p-3 border-b border-surface-subtle-light dark:border-surface-subtle-dark flex items-center justify-center bg-surface-light/60 dark:bg-surface-dark/60 backdrop-blur-md sticky top-0 z-10">
        <FormatToolbar onApplyFormat={handleFormat} />
      </div>

      {/* Main editable note sheet */}
      <div className="flex-1 overflow-y-auto px-6 py-8 md:px-12 lg:px-16 md:py-12 flex justify-center" data-note-surface="text">
        <div className="w-full max-w-4xl xl:max-w-5xl min-h-[500px] transition-all duration-300">
          {sheet}
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
});

TextEditor.displayName = 'TextEditor';
