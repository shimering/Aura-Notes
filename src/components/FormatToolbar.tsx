import { useEffect, useRef, useState } from 'react';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ChevronDown, ClipboardPaste,
  Copy, Eraser, IndentDecrease, IndentIncrease, Italic, List, ListOrdered, Minus,
  Palette, Redo2, Scissors, Strikethrough, Subscript, Superscript, Underline, Undo2,
  type LucideIcon,
} from 'lucide-react';
import { ColorPalette } from './ColorPalette';

interface FormatToolbarProps {
  onApplyFormat: (command: string, value?: string) => void;
  compact?: boolean;
}

const FONT_FAMILIES = ['Arial', 'Georgia', 'Segoe UI', 'Times New Roman', 'Verdana', 'Courier New'];
const FONT_SIZES = [
  ['1', '8'], ['2', '10'], ['3', '12'], ['4', '14'], ['5', '18'], ['6', '24'], ['7', '36'],
];

export function FormatToolbar({ onApplyFormat, compact = false }: FormatToolbarProps) {
  const [showColors, setShowColors] = useState(false);
  const toolbar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showColors) return;
    const dismiss = (event: PointerEvent) => {
      if (!toolbar.current?.contains(event.target as Node)) setShowColors(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [showColors]);

  const command = (Icon: LucideIcon, label: string, name: string, expandedOnly = false) =>
    (!compact || !expandedOnly) && (
      <button
        type="button"
        className="ribbon-command"
        title={label}
        aria-label={label}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setShowColors(false);
          onApplyFormat(name);
        }}
      >
        <Icon size={16} />
      </button>
    );

  return (
    <div
      ref={toolbar}
      className="ribbon-groups ribbon-home"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setShowColors(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setShowColors(false);
      }}
    >
      {!compact && (
        <div className="ribbon-group">
          <div className="ribbon-row">
            <button type="button" className="ribbon-command ribbon-large-command"
              onMouseDown={(event) => event.preventDefault()} onClick={() => onApplyFormat('paste')}>
              <ClipboardPaste size={21} /> Paste
            </button>
            <div className="ribbon-stack">
              {command(Scissors, 'Cut', 'cut')}
              {command(Copy, 'Copy', 'copy')}
            </div>
          </div>
          <span className="ribbon-group-label">Clipboard</span>
        </div>
      )}
      <div className="ribbon-group">
        <div className="ribbon-row">
          <select className="ribbon-select ribbon-font" aria-label="Font family" value=""
            onChange={(event) => onApplyFormat('fontName', event.target.value)}>
            <option value="" disabled>Font</option>
            {FONT_FAMILIES.map((font) => <option key={font}>{font}</option>)}
          </select>
          <select className="ribbon-select" aria-label="Font size" value=""
            onChange={(event) => onApplyFormat('fontSize', event.target.value)}>
            <option value="" disabled>Size</option>
            {FONT_SIZES.map(([value, label]) => <option key={value} value={value}>{label} pt</option>)}
          </select>
          {compact && (
            <>
              {command(Undo2, 'Undo text edit', 'undo')}
              {command(Redo2, 'Redo text edit', 'redo')}
            </>
          )}
        </div>
        <div className="ribbon-row">
          {command(Bold, 'Bold', 'bold')}
          {command(Italic, 'Italic', 'italic')}
          {command(Underline, 'Underline', 'underline')}
          {command(Strikethrough, 'Strikethrough', 'strikeThrough', true)}
          {command(Subscript, 'Subscript', 'subscript', true)}
          {command(Superscript, 'Superscript', 'superscript', true)}
          <button type="button" className="ribbon-command" aria-label="Text color and highlight"
            title="Text color and highlight" aria-expanded={showColors}
            onMouseDown={(event) => event.preventDefault()} onClick={() => setShowColors(!showColors)}>
            <Palette size={16} /><ChevronDown size={11} />
          </button>
          {command(Eraser, 'Clear formatting', 'removeFormat', true)}
        </div>
        {!compact && <span className="ribbon-group-label">Font</span>}
      </div>
      <div className="ribbon-group">
        <div className="ribbon-row">
          {command(List, 'Bullets', 'insertUnorderedList')}
          {command(ListOrdered, 'Numbering', 'insertOrderedList')}
          {command(IndentDecrease, 'Decrease indent', 'outdent', true)}
          {command(IndentIncrease, 'Increase indent', 'indent', true)}
          {command(Minus, 'Horizontal divider', 'insertHorizontalRule', true)}
        </div>
        <div className="ribbon-row">
          {command(AlignLeft, 'Align left', 'justifyLeft')}
          {command(AlignCenter, 'Center', 'justifyCenter')}
          {command(AlignRight, 'Align right', 'justifyRight')}
          {command(AlignJustify, 'Justify', 'justifyFull')}
        </div>
        {!compact && <span className="ribbon-group-label">Paragraph</span>}
      </div>
      {!compact && (
        <div className="ribbon-group">
          <div className="ribbon-row">
            {command(Undo2, 'Undo text edit', 'undo')}
            {command(Redo2, 'Redo text edit', 'redo')}
          </div>
          <div className="ribbon-row">
            {([['Body text', 'p'], ['Heading 1', 'h1'], ['Heading 2', 'h2'], ['Quote', 'blockquote']]).map(([label, tag]) => (
              <button type="button" key={tag} className={`ribbon-command ribbon-style ribbon-style-${tag}`}
                onMouseDown={(event) => event.preventDefault()} onClick={() => onApplyFormat('formatBlock', tag)}>
                {label}
              </button>
            ))}
          </div>
          <span className="ribbon-group-label">Styles</span>
        </div>
      )}
      {showColors && (
        <div className="ribbon-popover">
          <ColorPalette
            onSelectTextColor={(color) => {
              onApplyFormat('foreColor', color);
              setShowColors(false);
            }}
            onSelectHighlightColor={(color) => {
              onApplyFormat('hiliteColor', color);
              setShowColors(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
