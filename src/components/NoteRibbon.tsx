import { useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import {
  AlignJustify, ArrowRight, ChevronDown, ChevronUp, Circle, Ellipsis, FileText, Grid3x3, Image, Infinity as InfinityIcon,
  Maximize2, Pencil, Plus, RectangleHorizontal, RectangleVertical, Spline, Square, Table2, Type,
} from 'lucide-react';
import { ArrowKind, InkBackground, PageLayout } from '../types/note';
import { INK_BACKGROUNDS, PAGE_COLORS } from '../utils/inkBackground';
import { FormatToolbar } from './FormatToolbar';
import type { TextEditorRef } from './TextEditor';

const TABS = ['Home', 'Insert', 'Page Layout', 'Draw'] as const;
type StandardTab = typeof TABS[number];
export interface RibbonSelection {
  tab: 'Picture Tools' | 'Table Tools' | 'Text Box Tools' | 'Ink Tools' | 'Selection Tools' | 'Arrow Tools';
  target: HTMLElement | string;
  tools: ReactNode;
}
type RibbonTab = StandardTab | RibbonSelection['tab'];

const BACKGROUND_ICONS = { none: Square, ruled: AlignJustify, grid: Grid3x3, dotted: Circle };
const PAGE_LAYOUTS = [
  { value: 'portrait', label: 'Portrait', Icon: RectangleVertical },
  { value: 'landscape', label: 'Landscape', Icon: RectangleHorizontal },
  { value: 'canvas', label: 'Canvas', Icon: InfinityIcon },
] as const;

interface NoteRibbonProps {
  editor: RefObject<TextEditorRef | null>;
  isPhone?: boolean;
  notesMenuButton?: ReactNode;
  enableText: () => void;
  onFocusText: () => void;
  onFinishText: () => void;
  onStartDrawing: () => void;
  onFitWidth: () => void;
  onInsertTextBox: () => void;
  onInsertTable: (rows: number, columns: number) => void;
  onInsertPicture: (file: File) => void;
  /** Active arrow tool, if any: the next page drag draws that arrow. */
  arrowMode?: ArrowKind | null;
  onArrowMode: (kind: ArrowKind) => void;
  textActive: boolean;
  drawRequest: number;
  drawingTools: ReactNode;
  orientation: PageLayout;
  background: InkBackground;
  /** Surface colour of the note sheet or the endless canvas. */
  pageColor?: string;
  onOrientationChange: (layout: PageLayout) => void;
  onBackgroundChange: (background: InkBackground) => void;
  onPageColorChange: (color?: string) => void;
  selection?: RibbonSelection;
  keyboardOpen?: boolean;
  textEditing?: boolean;
}

export function NoteRibbon({
  editor, isPhone = false, notesMenuButton, enableText, onFocusText, onFinishText, onStartDrawing, onFitWidth,
  onInsertTextBox, onInsertTable, onInsertPicture, arrowMode, onArrowMode, textActive, drawRequest, drawingTools,
  orientation, background, pageColor, onOrientationChange, onBackgroundChange, onPageColorChange,
  selection, keyboardOpen = false, textEditing = false,
}: NoteRibbonProps) {
  const id = useId();
  const [standardTab, setStandardTab] = useState<StandardTab>('Insert');
  const target = selection?.target;
  const [previousTarget, setPreviousTarget] = useState(target);
  const [previousEditing, setPreviousEditing] = useState(textEditing);
  const [previousDrawRequest, setPreviousDrawRequest] = useState(drawRequest);
  const [tabOverride, setTabOverride] = useState<RibbonTab>();
  const [phonePanel, setPhonePanel] = useState<'tools' | 'more'>();
  if (target !== previousTarget || textEditing !== previousEditing || drawRequest !== previousDrawRequest) {
    setPreviousTarget(target);
    setPreviousEditing(textEditing);
    setPreviousDrawRequest(drawRequest);
    if (drawRequest !== previousDrawRequest) {
      setStandardTab('Draw');
      if (isPhone) setPhonePanel('tools');
    }
    setTabOverride(undefined);
  }
  const tabs: readonly RibbonTab[] = selection ? [...TABS, selection.tab] : TABS;
  const showHeader = !isPhone || phonePanel === 'more';
  const typingOnPhone = isPhone && keyboardOpen && textEditing;
  const quickFormat = typingOnPhone && !showHeader;
  const tab = quickFormat ? 'Home' : tabOverride ?? (textEditing ? 'Home' : selection?.tab ?? standardTab);
  const showPanel = !isPhone || !!phonePanel || quickFormat || tab === selection?.tab;
  const activeTab = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (activeTab.current) {
      const button = activeTab.current;
      const list = button.parentElement!;
      if (button.offsetLeft < list.scrollLeft) list.scrollLeft = button.offsetLeft;
      else if (button.offsetLeft + button.offsetWidth > list.scrollLeft + list.clientWidth) {
        list.scrollLeft = button.offsetLeft + button.offsetWidth - list.clientWidth;
      }
    }
  }, [tab, showHeader]);
  const [preferCompact, setPreferCompact] = useState(true);
  const compact = isPhone || keyboardOpen || preferCompact;
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
    onInsertTable(Number(values.get('rows')), Number(values.get('columns')));
  };

  const selectTab = (next: RibbonTab) => {
    const standard = TABS.find((name) => name === next);
    if (standard) setStandardTab(standard);
    setTabOverride(next);
    setShowTable(false);
  };

  const togglePhoneTools = (next: 'Draw' | 'Insert') => {
    if (phonePanel === 'tools' && tab === next) {
      setPhonePanel(undefined);
      setShowTable(false);
      return;
    }
    setPhonePanel('tools');
    selectTab(next);
    if (next === 'Draw') onStartDrawing();
  };

  const phoneMoreButton = (
    <button type="button" className="phone-editor-action" aria-expanded={showHeader}
      aria-label={typingOnPhone ? 'More formatting' : 'More tools'} onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        setPhonePanel(phonePanel === 'more' ? undefined : 'more');
        if (typingOnPhone) selectTab('Home');
        else setShowTable(false);
      }}><Ellipsis size={20} /> {!typingOnPhone && 'More'}</button>
  );
  const phoneDoneButton = (
    <button type="button" className="phone-editor-action phone-done" onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        setPhonePanel(undefined);
        onFinishText();
      }}>Done</button>
  );

  return (
    <section className={`note-ribbon ${isPhone ? 'phone-ribbon' : ''}`} data-compact={compact}
      data-keyboard-open={keyboardOpen} aria-label="Note ribbon">
      {showHeader && <div className="ribbon-header">
        {!isPhone && notesMenuButton}
        <div className="ribbon-tabs" role="tablist" aria-label="Ribbon tabs">
          {tabs.map((name, index) => (
            <button key={name} type="button" role="tab" id={`${id}-tab-${index}`}
              ref={name === tab ? activeTab : undefined}
              className={name === selection?.tab ? 'ribbon-context-tab' : undefined}
              aria-selected={name === tab} aria-controls={`${id}-panel`} tabIndex={name === tab ? 0 : -1}
              onMouseDown={(event) => event.preventDefault()} onClick={() => selectTab(name)}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
                else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = tabs.length - 1;
                else return;
                event.preventDefault();
                selectTab(tabs[next]);
                document.getElementById(`${id}-tab-${next}`)?.focus();
              }}>
              {name}
            </button>
          ))}
        </div>
        <div className="ribbon-header-tools">
          {isPhone ? <button type="button" className="phone-editor-action" title={orientation === 'canvas' ? 'Fit canvas content' : 'Fit page width'}
            aria-label={orientation === 'canvas' ? 'Fit canvas content' : 'Fit page width'}
            onClick={onFitWidth}><Maximize2 size={17} /></button> : <button type="button" className="ribbon-command"
            aria-label="Text tool" title="Text tool" aria-pressed={textActive}
            onMouseDown={(event) => event.preventDefault()} onClick={onFocusText}>
            <Type size={16} />
          </button>}
          {!isPhone && !keyboardOpen && <button type="button" className="ribbon-command ribbon-toggle"
            onMouseDown={(event) => event.preventDefault()} onClick={() => setPreferCompact(!preferCompact)}
            title={compact ? 'Expand ribbon' : 'Switch to compact ribbon'}
            aria-label={compact ? 'Expand ribbon' : 'Switch to compact ribbon'}>
            {compact ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>}
        </div>
      </div>}

      {showPanel && <div role="tabpanel" id={`${id}-panel`} aria-labelledby={showHeader ? `${id}-tab-${tabs.indexOf(tab)}` : undefined}
        aria-label={showHeader ? undefined : tab}
        className="ribbon-panel" onKeyDown={(event) => {
          if (event.key === 'Escape') setShowTable(false);
        }}>
        {tab === 'Home' && (
          <FormatToolbar compact={compact} quickActions={quickFormat ? <>{phoneMoreButton}{phoneDoneButton}</> : undefined}
            onApplyFormat={(command, value) =>
            void edit((current) => current.applyFormat(command, value))} />
        )}
        {tab === 'Insert' && (
          <div className="ribbon-groups">
            <div className="ribbon-group">
              <div className="ribbon-row">
                <button type="button" className="ribbon-command ribbon-large-command"
                  onMouseDown={(event) => event.preventDefault()} onClick={() => {
                    setShowTable(false);
                    setMessage('');
                    onInsertTextBox();
                  }}>
                  <Type size={21} /> Text Box
                </button>
                <button type="button" className="ribbon-command ribbon-large-command" aria-expanded={showTable}
                  onMouseDown={(event) => event.preventDefault()} onClick={() => setShowTable(!showTable)}>
                  <Table2 size={21} /> Table
                </button>
              </div>
              {!compact && <span className="ribbon-group-label">Objects</span>}
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
            <div className="ribbon-group">
              <div className="ribbon-row">
                <button type="button" className="ribbon-command ribbon-large-command"
                  aria-pressed={arrowMode === 'straight'} title="Straight arrow: drag between elements"
                  onMouseDown={(event) => event.preventDefault()} onClick={() => onArrowMode('straight')}>
                  <ArrowRight size={21} /> Straight arrow
                </button>
                <button type="button" className="ribbon-command ribbon-large-command"
                  aria-pressed={arrowMode === 'curved'} title="Curved arrow: drag a bend to reshape it"
                  onMouseDown={(event) => event.preventDefault()} onClick={() => onArrowMode('curved')}>
                  <Spline size={21} /> Curved arrow
                </button>
              </div>
              {!compact && <span className="ribbon-group-label">Arrows</span>}
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
                {PAGE_LAYOUTS.map(({ value, label, Icon }) => (
                  <button type="button" key={value} className="ribbon-command ribbon-large-command"
                    aria-pressed={orientation === value} onClick={() => onOrientationChange(value)}>
                    <Icon size={21} /> {label}
                  </button>
                ))}
              </div>
              {!compact && <span className="ribbon-group-label">Page layout</span>}
            </div>
            <div className="ribbon-group">
              <div className="ribbon-row">
                {PAGE_COLORS.map(({ value, label: colorLabel }) => {
                  const label = !value && orientation !== 'canvas' ? 'Paper (default)' : colorLabel;
                  const space = orientation === 'canvas' ? 'Canvas' : 'Page';
                  return (
                    <button type="button" key={label} className="ribbon-command canvas-color"
                      aria-label={`${space} color: ${label}`} title={label}
                      aria-pressed={(pageColor ?? undefined) === value}
                      onClick={() => onPageColorChange(value)}>
                      <span className={`canvas-swatch${value ? '' : orientation === 'canvas' ? ' canvas-swatch-desk' : ' canvas-swatch-paper'}`}
                        style={value ? { backgroundColor: value } : undefined} />
                    </button>
                  );
                })}
              </div>
              {!compact && <span className="ribbon-group-label">{orientation === 'canvas' ? 'Canvas color' : 'Page color'}</span>}
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
        {tab === selection?.tab && selection.tools}
      </div>}

      {isPhone && !quickFormat && (
        <div className="phone-editor-tools" role="group" aria-label="Editor tools">
          {typingOnPhone ? <>{phoneMoreButton}{phoneDoneButton}</> : <>
            <button type="button" className="phone-editor-action" onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setPhonePanel(undefined);
                selectTab('Home');
                onFocusText();
              }}><Type size={19} /> Type</button>
            <button type="button" className="phone-editor-action" aria-expanded={showPanel && tab === 'Draw'}
              onClick={() => togglePhoneTools('Draw')}><Pencil size={18} /> Draw</button>
            <button type="button" className="phone-editor-action" aria-expanded={showPanel && tab === 'Insert'}
              onMouseDown={(event) => event.preventDefault()} onClick={() => togglePhoneTools('Insert')}><Plus size={21} /> Insert</button>
            {phoneMoreButton}
          </>}
        </div>
      )}

      <input hidden ref={pictureInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) onInsertPicture(file);
        }} />
      <input hidden ref={pdfInput} type="file" accept=".pdf,application/pdf"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void edit((current) => current.insertPdf(file));
        }} />
      {message && <div className="ribbon-message" role="alert">{message}</div>}
    </section>
  );
}
