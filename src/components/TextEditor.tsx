import React, { forwardRef, useImperativeHandle, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import type { NotePage } from '../types/note';
import { FormatToolbar } from './FormatToolbar';
import { pdfData, sanitizeNoteHtml } from '../utils/noteHtml';
import type { Point } from '../utils/inkSelection';
import { boxSelector, offsetWithin, placePicture } from '../utils/pageObjects';
import { createNoteTable, ensureTableColumns, recalculateTable, tableBoxSelector } from '../utils/noteTable';

export type InsertionPosition = Point & { centered?: boolean };

export interface TextEditorRef {
  focusEditor: () => void;
  insertTextBox: (position: InsertionPosition) => void;
  editBox: (box: HTMLElement, cell?: HTMLTableCellElement) => void;
  finishEditing: (keepEmpty?: boolean) => void;
  appendTextBox: (markup: string) => void;
  replacePicture: (image: HTMLImageElement, file: File) => Promise<void>;
  savePageObjects: () => void;
  dropPictures: (files: File[], position: InsertionPosition) => Promise<HTMLImageElement[]>;
  applyFormat: (command: string, value?: string) => Promise<void>;
  insertTable: (rows: number, columns: number, position: InsertionPosition) => HTMLElement | undefined;
  insertPdf: (file: File) => Promise<void>;
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
  note: NotePage;
  onChangeContent: (content: string) => void;
  onEditingChange?: (active: boolean) => void;
  getNoteSize?: (content: string) => number;
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

function createTextBox(point: Point, width: number | null, markup: string) {
  const box = document.createElement('div');
  box.dataset.notePositioned = 'true';
  box.style.left = `${Math.round(point.x)}px`;
  box.style.top = `${Math.round(point.y)}px`;
  if (width !== null) box.style.width = `${Math.round(width)}px`;
  box.innerHTML = markup;
  return box;
}

function centerBox(box: HTMLElement, point: Point) {
  box.style.left = `${Math.round(point.x - box.offsetWidth / 2)}px`;
  box.style.top = `${Math.round(point.y - box.offsetHeight / 2)}px`;
}

function boxHasContent(box: HTMLElement) {
  return !!box.textContent?.trim() || !!box.querySelector('a, table, hr');
}

/** Bring legacy flow content onto the object canvas while keeping its rich markup. */
function loadPageObjects(editor: HTMLElement, html: string) {
  const template = document.createElement('template');
  template.innerHTML = sanitizeNoteHtml(html);
  const children = Array.from(template.content.childNodes);
  const flowBoxes: HTMLElement[] = [];
  let legacyBox: HTMLElement | null = null;
  for (const node of children) {
    if (node instanceof HTMLElement && node.matches(boxSelector)) {
      legacyBox = null;
      if (node.tagName === 'P') {
        const box = createTextBox({ x: 0, y: 0 }, null, '');
        box.style.cssText = node.style.cssText;
        box.append(node.cloneNode(true));
        const paragraph = box.firstElementChild as HTMLElement;
        paragraph.removeAttribute('data-note-positioned');
        paragraph.style.left = paragraph.style.top = paragraph.style.width = paragraph.style.rotate = '';
        node.replaceWith(box);
      }
      continue;
    }
    if (node instanceof HTMLImageElement && node.dataset.pictureWrap === 'free') {
      legacyBox = null;
      continue;
    }
    if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim() && !legacyBox) {
      node.remove();
      continue;
    }
    if (!legacyBox) {
      legacyBox = createTextBox({ x: 0, y: 0 }, null, '');
      // Let legacy in-flow markup take up its natural space during measurement.
      legacyBox.style.position = 'relative';
      legacyBox.style.top = '';
      node.before(legacyBox);
      flowBoxes.push(legacyBox);
    }
    legacyBox.append(node);
    if (node instanceof HTMLElement && (node.matches('table, img') ||
      (!node.textContent?.trim() && node.querySelector('table, img')))) legacyBox = null;
  }

  editor.replaceChildren(template.content);
  const images = Array.from(editor.querySelectorAll('img')).filter((image) => image.parentElement !== editor);
  const placements = images.map((image) => {
    const point = offsetWithin(image, editor);
    return { image, point, width: image.offsetWidth || parseInt(image.style.width, 10) || 280 };
  });
  const legacyTables = Array.from(editor.querySelectorAll('table')).filter((table) => !table.closest(tableBoxSelector));
  const tables = legacyTables.map((table) => {
    const point = offsetWithin(table, editor);
    const box = createTextBox(point, null, '');
    box.dataset.noteTable = 'true';
    const widths = Array.from(table.rows[0]?.cells ?? [], (cell) => cell.offsetWidth);
    return { table, box, widths };
  });
  const tops = flowBoxes.map((box) => box.offsetTop);
  flowBoxes.forEach((box, index) => {
    box.style.position = '';
    box.style.top = `${tops[index]}px`;
  });
  placements.forEach(({ image, point, width }) => {
    editor.append(image);
    placePicture(image, point, width, (parseFloat(image.style.rotate) || 0) * Math.PI / 180);
  });
  tables.forEach(({ table, box, widths }) => {
    box.append(table);
    editor.append(box);
    const columns = ensureTableColumns(table);
    widths.forEach((width, index) => {
      if (width) (columns.children[index] as HTMLElement).style.width = `${width}px`;
    });
    ensureTableColumns(table);
  });
  editor.querySelectorAll<HTMLElement>(`:scope > ${boxSelector}`).forEach((box) => {
    if (!boxHasContent(box)) box.remove();
  });
}

export const TextEditor = forwardRef<TextEditorRef, TextEditorProps>((
  { note, onChangeContent, onEditingChange, getNoteSize, embedded = false, editable = true },
  ref
) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const internalUpdateRef = useRef<{ noteId: string; content: string } | null>(null);
  const savedRange = useRef<Range | null>(null);
  const activeBox = useRef<HTMLElement | null>(null);
  const activeHost = useRef<HTMLElement | null>(null);
  const lastBox = useRef<HTMLElement | null>(null);
  const latestNote = useRef(note);
  latestNote.current = note;
  const latestNoteSize = useRef(getNoteSize);
  latestNoteSize.current = getNoteSize;
  const exceedsNoteLimit = (content: string) =>
    (latestNoteSize.current?.(content) ?? new Blob([JSON.stringify({ ...latestNote.current, content })]).size) > MAX_NOTE_BYTES;

  useEffect(() => {
    const rememberSelection = () => {
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (activeHost.current?.contains(range.commonAncestorContainer)) {
        savedRange.current = range.cloneRange();
      }
    };
    document.addEventListener('selectionchange', rememberSelection);
    return () => document.removeEventListener('selectionchange', rememberSelection);
  }, []);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const internalUpdate = internalUpdateRef.current;
    internalUpdateRef.current = null;
    if (internalUpdate?.noteId === note.id && internalUpdate.content === note.content) return;
    if (sanitizeNoteHtml(editor.innerHTML) === note.content && !activeBox.current) return;
    activeBox.current = activeHost.current = null;
    onEditingChange?.(false);
    savedRange.current = null;
    lastBox.current = null;
    loadPageObjects(editor, note.content);
  }, [note.id, note.content]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const fitContent = () => {
      const bottom = Array.from(editor.children).reduce((max, child) => {
        const object = child as HTMLElement;
        return Math.max(max, object.offsetTop + object.offsetHeight);
      }, 0);
      editor.style.minHeight = bottom > 400 ? `${bottom}px` : '';
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fitContent);
    const observed = new Set<Element>();
    const update = () => {
      for (const child of observed) {
        if (child.parentElement === editor) continue;
        observer?.unobserve(child);
        observed.delete(child);
      }
      for (const child of editor.children) {
        if (observed.has(child)) continue;
        observer?.observe(child);
        observed.add(child);
      }
      fitContent();
    };
    const mutations = new MutationObserver(update);
    mutations.observe(editor, { childList: true });
    editor.addEventListener('load', fitContent, true);
    update();
    return () => {
      observer?.disconnect();
      mutations.disconnect();
      editor.removeEventListener('load', fitContent, true);
    };
  }, []);

  const finishEditing = (keepEmpty = false) => {
    const box = activeBox.current;
    if (!box) return;
    const host = activeHost.current;
    activeBox.current = activeHost.current = null;
    onEditingChange?.(false);
    host?.blur();
    host?.removeAttribute('contenteditable');
    if (!keepEmpty && !boxHasContent(box)) box.remove();
    savedRange.current = null;
  };

  useLayoutEffect(() => {
    if (!editable) finishEditing();
  }, [editable]);

  const getEditorRange = (box: HTMLElement) => {
    const selection = window.getSelection();
    const current = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (current && box.contains(current.commonAncestorContainer)) return current.cloneRange();
    if (savedRange.current && box.contains(savedRange.current.commonAncestorContainer)) return savedRange.current.cloneRange();
    const end = document.createRange();
    end.selectNodeContents(box);
    end.collapse(false);
    return end;
  };

  const focusRange = (box: HTMLElement, range: Range) => {
    box.focus({ preventScroll: true });
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const handleInput = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const content = sanitizeNoteHtml(Array.from(editor.children)
      .filter((node) => !node.matches(boxSelector) || boxHasContent(node as HTMLElement))
      .map((node) => node.outerHTML).join(''));
    const previous = internalUpdateRef.current?.content ?? latestNote.current.content;
    if (content === previous) return;
    internalUpdateRef.current = { noteId: note.id, content };
    onChangeContent(content);
    return content;
  };

  const editBox = (box: HTMLElement, cell?: HTMLTableCellElement) => {
    if (box.parentElement !== editorRef.current || !box.matches(boxSelector)) return;
    const host = cell && box.contains(cell) ? cell : box.querySelector<HTMLTableCellElement>('td, th') ?? box;
    if (activeHost.current !== host) finishEditing();
    host.setAttribute('contenteditable', 'true');
    activeBox.current = lastBox.current = box;
    activeHost.current = host;
    onEditingChange?.(true);
    focusRange(host, getEditorRange(host));
  };

  const addBox = (point: InsertionPosition, markup = '<p><br></p>') => {
    const editor = editorRef.current;
    if (!editor) return;
    const availableWidth = editor.clientWidth - (point.centered ? 0 : point.x);
    const box = createTextBox(point, Math.max(96, Math.min(320, availableWidth)), markup);
    editor.append(box);
    if (point.centered) centerBox(box, point);
    return box;
  };

  const nextBoxPoint = () => ({
    x: 0,
    y: Math.max(-16, ...Array.from(editorRef.current?.children ?? [], (child) => {
      const object = child as HTMLElement;
      return object.offsetTop + object.offsetHeight;
    })) + 16,
  });

  const focusAt = (point: InsertionPosition) => {
    finishEditing();
    const box = addBox(point);
    if (box) editBox(box);
    return box;
  };

  const getWritingBox = () => {
    if (activeHost.current) return activeHost.current;
    const editor = editorRef.current;
    if (!editor) return;
    const box = lastBox.current?.parentElement === editor && !lastBox.current.matches(tableBoxSelector) ? lastBox.current
      : editor.querySelector<HTMLElement>(`:scope > ${boxSelector}:not(${tableBoxSelector})`) ?? addBox(nextBoxPoint());
    if (box) editBox(box);
    return activeHost.current ?? undefined;
  };

  const dropPictures = async (files: File[], point: InsertionPosition) => {
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
      const availableWidth = editor.clientWidth - (point.centered ? 0 : point.x);
      const width = Math.max(48, Math.min(280, availableWidth));
      if (point.centered) await image.decode?.().catch(() => undefined);
      const height = image.naturalWidth ? width * image.naturalHeight / image.naturalWidth : 0;
      const offset = index * 16;
      placePicture(image, {
        x: point.x + offset - (point.centered ? width / 2 : 0),
        y: point.y + offset - (point.centered ? height / 2 : 0),
      }, width);
      return image;
    }));
    if (editor !== editorRef.current || noteId !== latestNote.current.id) return [];
    const content = sanitizeNoteHtml(editor.innerHTML) + images.map((image) => image.outerHTML).join('');
    if (exceedsNoteLimit(content)) {
      throw new Error('These pictures would take the note above the 10 MB sync limit.');
    }
    editor.append(...images);
    handleInput();
    return images;
  };

  const handleFormat = async (command: string, value: string = '') => {
    const editor = getWritingBox();
    if (!editor) return;
    const range = getEditorRange(editor);
    const noteId = note.id;
    if (command === 'paste') {
      if (!navigator.clipboard?.readText) throw new Error('Use Ctrl+V or your device’s Paste command.');
      try {
        value = await navigator.clipboard.readText();
      } catch {
        throw new Error('Clipboard access was blocked. Use Ctrl+V or your device’s Paste command.');
      }
      if (activeHost.current !== editor || latestNote.current.id !== noteId ||
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

  const insertMarkup = (editor: HTMLElement, range: Range, markup: string) => {
    focusRange(editor, range);
    if (!document.execCommand('insertHTML', false, markup)) {
      throw new Error('Could not insert content. Place the cursor on the page and try again.');
    }
    handleInput();
  };

  const replacePicture = async (image: HTMLImageElement, file: File) => {
    const noteId = latestNote.current.id;
    if (!file.size || file.size > MAX_FILE_BYTES || !pictureType.test(file.type)) {
      throw new Error('Choose a PNG, JPEG, GIF, WebP, AVIF or BMP picture up to 5 MB.');
    }
    const data = await readDataUrl(file);
    const editor = editorRef.current;
    if (latestNote.current.id !== noteId || !editor?.contains(image)) return;
    const replacement = image.cloneNode() as HTMLImageElement;
    replacement.src = data;
    replacement.alt = file.name;
    const content = Array.from(editor.children, (node) => node === image ? replacement.outerHTML : node.outerHTML).join('');
    if (exceedsNoteLimit(content)) {
      throw new Error('This picture would take the note above the 10 MB sync limit.');
    }
    image.src = data;
    image.alt = file.name;
    handleInput();
  };

  const insertPdf = async (file: File) => {
    const noteId = note.id;
    if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('Choose a file between 1 byte and 5 MB.');
    if (!(await file.slice(0, 5).text()).startsWith('%PDF-')) throw new Error('The selected file is not a PDF.');
    const data = await readDataUrl(file);
    if (!editorRef.current || latestNote.current.id !== noteId) return;
    const link = document.createElement('a');
    link.href = data.replace(/^data:[^,]*,/, 'data:application/pdf;base64,');
    link.download = file.name;
    link.textContent = file.name;
    const markup = `<p>${link.outerHTML}</p><p><br></p>`;
    const content = sanitizeNoteHtml(editorRef.current.innerHTML) + markup;
    if (exceedsNoteLimit(content)) {
      throw new Error('This file would take the note above the 10 MB sync limit.');
    }
    const box = getWritingBox();
    if (box) insertMarkup(box, getEditorRange(box), markup);
  };

  useImperativeHandle(ref, () => ({
    focusEditor: () => {
      const box = getWritingBox();
      if (box) focusRange(box, getEditorRange(box));
    },
    insertTextBox: (point) => {
      focusAt(point)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    },
    editBox,
    finishEditing,
    appendTextBox: (markup) => {
      const box = addBox(nextBoxPoint(), sanitizeNoteHtml(markup));
      if (box) handleInput();
    },
    savePageObjects: handleInput,
    dropPictures,
    replacePicture,
    applyFormat: handleFormat,
    insertTable: (rows, columns, point) => {
      const editor = editorRef.current;
      if (!editor) return;
      const box = createTextBox(point, null, '');
      box.dataset.noteTable = 'true';
      const table = createNoteTable(rows, columns);
      box.append(table);
      editor.append(box);
      if (point.centered) centerBox(box, point);
      finishEditing();
      handleInput();
      return box;
    },
    insertPdf,
  }));

  const handlePaste = (e: React.ClipboardEvent) => {
    const box = activeBox.current;
    if (!box) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  };

  // Tab indents a list item instead of moving focus out of the note.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;

    const anchor = window.getSelection()?.anchorNode;
    const editor = activeHost.current;
    if (!anchor || !editor || !editor.contains(anchor)) return;

    const element = anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement;
    const cell = element?.closest<HTMLTableCellElement>('td, th');
    if (cell) {
      const cells = Array.from(cell.closest('table')?.querySelectorAll<HTMLTableCellElement>('td, th') ?? []);
      const next = cells[cells.indexOf(cell) + (e.shiftKey ? -1 : 1)];
      if (next) {
        e.preventDefault();
        const box = activeBox.current;
        if (box) editBox(box, next);
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
      onInput={() => {
        const cell = activeHost.current;
        if (cell instanceof HTMLTableCellElement) {
          delete cell.dataset.cellFormula;
          const table = cell.closest('table');
          if (table) recalculateTable(table);
        }
        handleInput();
      }}
      onDoubleClick={(event) => {
        if (embedded || !(event.target instanceof Element)) return;
        const box = event.target.closest<HTMLElement>(boxSelector);
        if (box) editBox(box);
        else {
          const rect = event.currentTarget.getBoundingClientRect();
          focusAt({ x: event.clientX - rect.left, y: event.clientY - rect.top });
        }
      }}
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
      className="editable-note-content relative min-h-[400px] text-base md:text-lg text-ink-light dark:text-ink-dark leading-relaxed outline-none focus:outline-none font-sans"
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
