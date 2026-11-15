import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
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
    <nav className="note-page-bar" aria-label="Note pages">
      <div className="note-page-navigation">
        <button type="button" aria-label="Previous page" title="Previous page" disabled={pageIndex === 0}
          onClick={() => onSelect(pages[pageIndex - 1].id)}><ChevronLeft size={17} /></button>
        <select aria-label="Current page" value={pages[pageIndex].id} onChange={(event) => onSelect(event.target.value)}>
          {pages.map(({ id }, index) => <option key={id} value={id}>Page {index + 1} of {pages.length}</option>)}
        </select>
        <button type="button" aria-label="Next page" title="Next page" disabled={pageIndex === pages.length - 1}
          onClick={() => onSelect(pages[pageIndex + 1].id)}><ChevronRight size={17} /></button>
      </div>
      <div className="note-page-actions">
        <button type="button" className="note-page-add" onClick={onAdd}><Plus size={17} /> Add page</button>
        <button type="button" aria-label="Delete page" title="Delete page" disabled={pages.length <= 1}
          onClick={onDelete}><Trash2 size={16} /></button>
      </div>
    </nav>
  );
}
