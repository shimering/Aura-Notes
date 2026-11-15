import { useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import {
  AlignJustify, ChevronDown, ChevronUp, Circle, FileText, Grid3x3, Image, RectangleHorizontal,
  RectangleVertical, Square, Table2, Type,
} from 'lucide-react';
import { InkBackground, PageLayout } from '../types/note';
import { INK_BACKGROUNDS } from '../utils/inkBackground';
import { FormatToolbar } from './FormatToolbar';
import type { TextEditorRef } from './TextEditor';

const TABS = ['Home', 'Insert', 'Page Layout', 'Draw'] as const;
type RibbonTab = typeof TABS[number];

const BACKGROUND_ICONS = { none: Square, ruled: AlignJustify, grid: Grid3x3, dotted: Circle };
const ORIENTATIONS = [
  { value: 'portrait', label: 'Portrait', Icon: RectangleVertical },
  { value: 'landscape', label: 'Landscape', Icon: RectangleHorizontal },
] as const;

interface NoteRibbonProps {
  editor: RefObject<TextEditorRef | null>;
  enableText: () => void;
  textActive: boolean;
  drawingTools: ReactNode;
  orientation: PageLayout;
  background: InkBackground;
  onOrientationChange: (layout: PageLayout) => void;
  onBackgroundChange: (background: InkBackground) => void;
}

export function NoteRibbon({
  editor, enableText, textActive, drawingTools, orientation, background, onOrientationChange, onBackgroundChange,
}: NoteRibbonProps) {
  const id = useId();
  const [tab, setTab] = useState<RibbonTab>('Home');
  const [compact, setCompact] = useState(() => window.matchMedia?.('(max-width: 640px)').matches ?? false);
  const [showTable, setShowTable] = useState(false);
  const [message, setMessage] = useState('');
  const pictureInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);

  const edit = async (action: (editor: TextEditorRef) => void | Promise<void>) => {
    setMessage('');
    enableText();
    try {
      if (editor.current) await action(editor.current);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not edit the note.');
    }
  };

  const addTable = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setShowTable(false);
    void edit((current) => current.insertTable(Number(values.get('rows')), Number(values.get('columns'))));
  };

  const selectTab = (next: RibbonTab) => {
    setTab(next);
    setShowTable(false);
  };

  return (
    <section className="note-ribbon" data-compact={compact} aria-label="Note ribbon">
      <div className="ribbon-header">
        <div className="ribbon-tabs" role="tablist" aria-label="Ribbon tabs">
          {TABS.map((name, index) => (
            <button key={name} type="button" role="tab" id={`${id}-tab-${index}`}
              aria-selected={name === tab} aria-controls={`${id}-panel`} tabIndex={name === tab ? 0 : -1}
              onMouseDown={(event) => event.preventDefault()} onClick={() => selectTab(name)}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
                else if (event.key === 'ArrowLeft') next = (index + TABS.length - 1) % TABS.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = TABS.length - 1;
                else return;
                event.preventDefault();
                selectTab(TABS[next]);
                document.getElementById(`${id}-tab-${next}`)?.focus();
              }}>
              {name}
            </button>
          ))}
        </div>
        <div className="ribbon-header-tools">
          <button type="button" className="ribbon-command"
            aria-label="Text tool" title="Text tool" aria-pressed={textActive}
            onMouseDown={(event) => event.preventDefault()} onClick={() => {
              enableText();
              editor.current?.focusEditor();
            }}>
            <Type size={16} />
          </button>
          <button type="button" className="ribbon-command ribbon-toggle"
            onMouseDown={(event) => event.preventDefault()} onClick={() => setCompact(!compact)}
            title={compact ? 'Expand ribbon' : 'Switch to compact ribbon'}
            aria-label={compact ? 'Expand ribbon' : 'Switch to compact ribbon'}>
            {compact ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
      </div>

      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${TABS.indexOf(tab)}`}
        className="ribbon-panel" onKeyDown={(event) => {
          if (event.key === 'Escape') setShowTable(false);
        }}>
        {tab === 'Home' && (
          <FormatToolbar compact={compact} onApplyFormat={(command, value) =>
            void edit((current) => current.applyFormat(command, value))} />
        )}
        {tab === 'Insert' && (
          <div className="ribbon-groups">
            <div className="ribbon-group">
              <div className="ribbon-row">
                <button type="button" className="ribbon-command ribbon-large-command" aria-expanded={showTable}
                  onMouseDown={(event) => event.preventDefault()} onClick={() => setShowTable(!showTable)}>
                  <Table2 size={21} /> Table
                </button>
              </div>
              {!compact && <span className="ribbon-group-label">Tables</span>}
            </div>
            <div className="ribbon-group">
              <div className="ribbon-row">
                <button type="button" className="ribbon-command ribbon-large-command"
                  onMouseDown={(event) => event.preventDefault()} onClick={() => pictureInput.current?.click()}>
                  <Image size={21} /> Picture
                </button>
                <button type="button" className="ribbon-command ribbon-large-command"
                  onMouseDown={(event) => event.preventDefault()} onClick={() => pdfInput.current?.click()}>
                  <FileText size={21} /> PDF
                </button>
              </div>
              {!compact && <span className="ribbon-group-label">Files</span>}
            </div>
            {showTable && (
              <form className="ribbon-popover ribbon-table-form" onSubmit={addTable}>
                <label>Rows<input autoFocus name="rows" type="number" min="1" max="20" defaultValue="3" required /></label>
                <label>Columns<input name="columns" type="number" min="1" max="10" defaultValue="3" required /></label>
                <button type="submit">Insert table</button>
              </form>
            )}
          </div>
        )}
        {tab === 'Page Layout' && (
          <div className="ribbon-groups">
            <div className="ribbon-group">
              <div className="ribbon-row">
                {ORIENTATIONS.map(({ value, label, Icon }) => (
                  <button type="button" key={value} className="ribbon-command ribbon-large-command"
                    aria-pressed={orientation === value} onClick={() => onOrientationChange(value)}>
                    <Icon size={21} /> {label}
                  </button>
                ))}
              </div>
              {!compact && <span className="ribbon-group-label">A4 orientation</span>}
            </div>
            <div className="ribbon-group">
              <div className="ribbon-row">
                {INK_BACKGROUNDS.map(({ id, label }) => {
                  const Icon = BACKGROUND_ICONS[id];
                  return (
                    <button type="button" key={id} className="ribbon-command ribbon-large-command"
                      aria-pressed={background === id} onClick={() => onBackgroundChange(id)}>
                      <Icon size={21} /> {label}
                    </button>
                  );
                })}
              </div>
              {!compact && <span className="ribbon-group-label">Background</span>}
            </div>
          </div>
        )}
        {tab === 'Draw' && drawingTools}
      </div>

      <input hidden ref={pictureInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void edit((current) => current.insertFile(file, 'picture'));
        }} />
      <input hidden ref={pdfInput} type="file" accept=".pdf,application/pdf"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void edit((current) => current.insertFile(file, 'pdf'));
        }} />
      {message && <div className="ribbon-message" role="alert">{message}</div>}
    </section>
  );
}
