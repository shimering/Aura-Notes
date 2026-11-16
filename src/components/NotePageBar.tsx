import { useId, useRef } from 'react';
import { Check, ChevronLeft, ChevronRight, Files, Plus, Trash2, X } from 'lucide-react';
import type { NotePage } from '../types/note';

interface NotePageBarProps {
  pages: NotePage[];
  pageIndex: number;
  onSelect: (pageId: string) => void;
  onAdd: () => void;
  onDelete: () => void;
}

export function NotePageBar({ pages, pageIndex, onSelect, onAdd, onDelete }: NotePageBarProps) {
  return (
    <nav className="note-page-bar" aria-label="Note pages" data-ink-ui="page-controls">
      <div className="note-page-navigation">
        <button type="button" aria-label="Previous page" title="Previous page" disabled={pageIndex === 0}
          onClick={() => onSelect(pages[pageIndex - 1].id)}><ChevronLeft size={15} /></button>
        <select aria-label="Current page" value={pages[pageIndex].id} onChange={(event) => onSelect(event.target.value)}>
          {pages.map(({ id }, index) => <option key={id} value={id}>{index + 1} / {pages.length}</option>)}
        </select>
        <button type="button" aria-label="Next page" title="Next page" disabled={pageIndex === pages.length - 1}
          onClick={() => onSelect(pages[pageIndex + 1].id)}><ChevronRight size={15} /></button>
      </div>
      <div className="note-page-actions">
        <button type="button" className="note-page-add" aria-label="Add page" title="Add page"
          onClick={onAdd}><Plus size={15} /> Add</button>
        <button type="button" aria-label="Delete page" title="Delete page" disabled={pages.length <= 1}
          onClick={onDelete}><Trash2 size={15} /></button>
      </div>
    </nav>
  );
}

export function PhonePagePicker({ pages, pageIndex, onSelect, onAdd, onDelete }: NotePageBarProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  return (
    <>
      <button type="button" className="phone-editor-action phone-pages-trigger" aria-haspopup="dialog"
        aria-label={`Pages, ${pageIndex + 1} of ${pages.length}`} onClick={() => dialog.current?.showModal()}>
        <span>Pages</span> <span className="phone-page-number">{pageIndex + 1}/{pages.length}</span>
      </button>
      <dialog ref={dialog} className="phone-pages" aria-labelledby={titleId}
        onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
        <div className="phone-pages-content">
          <header>
            <h2 id={titleId}>Pages</h2>
            <button type="button" className="phone-editor-action" aria-label="Close pages"
              onClick={() => dialog.current?.close()}><X size={20} /></button>
          </header>
          <ol>
            {pages.map(({ id }, index) => (
              <li key={id}>
                <button type="button" aria-current={index === pageIndex ? 'page' : undefined} onClick={() => {
                  onSelect(id);
                  dialog.current?.close();
                }}>Page {index + 1}{index === pageIndex && <Check size={17} aria-hidden="true" />}</button>
              </li>
            ))}
          </ol>
          <footer>
            <button type="button" className="phone-editor-action phone-page-add" onClick={() => {
              onAdd();
              dialog.current?.close();
            }}><Plus size={18} /> Add page</button>
            <button type="button" className="phone-editor-action" disabled={pages.length < 2}
              onClick={onDelete}><Trash2 size={17} /> Delete page</button>
          </footer>
        </div>
      </dialog>
    </>
  );
}
