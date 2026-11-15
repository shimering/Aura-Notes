// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InkCanvas } from './InkCanvas';
import { TextEditor, type TextEditorRef } from './TextEditor';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onChangeStrokes = vi.fn();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 2 });
  onChangeStrokes.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<InkCanvas noteId="scratch" defaultTool="pen" strokes={[]} onChangeStrokes={onChangeStrokes} onScribbleToText={() => {}} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('pans the sheet with two fingers even with a little drift in finger spacing', () => {
  const viewport = container.querySelector<HTMLElement>('.note-desk')!;
  const canvas = container.querySelector<HTMLElement>('.ink-canvas')!;
  const paper = container.querySelector<HTMLElement>('.note-paper')!;
  viewport.scrollLeft = 180;
  viewport.scrollTop = 180;
  const initialScale = paper.style.transform;
  const fingers = (points: number[][]) => points.map(([clientX, clientY], identifier) => ({ clientX, clientY, identifier, target: canvas }));
  const fire = (type: string, points: number[][]) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: fingers(points) });
    act(() => canvas.dispatchEvent(event));
  };

  fire('touchstart', [[100, 100]]);
  fire('touchstart', [[100, 100], [200, 100]]);
  fire('touchmove', [[70, 60], [176, 60]]);
  expect(viewport.scrollLeft).toBe(207);
  expect(viewport.scrollTop).toBe(220);
  expect(paper.style.transform).toBe(initialScale);
  fire('touchend', [[70, 60]]);
  fire('touchmove', [[50, 50]]);
  expect(viewport.scrollLeft).toBe(207);
  fire('touchend', []);
  expect(onChangeStrokes).not.toHaveBeenCalled();
});

it('dismisses the quick palette by tapping outside, closing it, or choosing a tool', () => {
  const findButton = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"], button[title="${label}"]`)!;
  const dialog = () => container.querySelector('[role="dialog"]');
  const open = () => {
    for (let press = 0; press < 2; press++) {
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'StylusButtonPrimary' }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'StylusButtonPrimary' }));
      });
    }
    expect(dialog()).not.toBeNull();
  };

  open();
  act(() => findButton('Dismiss quick palette').click());
  expect(dialog()).toBeNull();
  open();
  act(() => findButton('Close quick palette').click());
  expect(dialog()).toBeNull();
  open();
  const highlighter = Array.from(dialog()!.querySelectorAll('button')).find((button) => button.textContent?.includes('Highlighter'))!;
  act(() => highlighter.click());
  expect(dialog()).toBeNull();
  expect(onChangeStrokes).not.toHaveBeenCalled();
});

it('opens Insert and focuses a new box from the ribbon or a blank touch at its original page coordinates', () => {
  const editorRef = createRef<TextEditorRef>();
  const save = vi.fn();
  const note = { id: 'scratch', title: 'Scratch', content: '<p>Existing text</p>', inkStrokes: [],
    tags: [], color: '', createdAt: 0, updatedAt: 0 };
  act(() => root.render(<InkCanvas noteId={note.id} defaultTool="pen" strokes={note.inkStrokes}
    onChangeStrokes={onChangeStrokes} onScribbleToText={() => {}} onChangeBackground={() => {}}
    textEditor={editorRef}
    textLayer={<TextEditor ref={editorRef} note={note} onChangeContent={save} embedded />} />));

  expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Insert');
  const textBoxButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Text Box');
  act(() => textBoxButton?.click());
  expect(container.querySelectorAll('[data-note-positioned]')).toHaveLength(2);
  expect(document.activeElement).toBe(container.querySelector('[data-note-positioned]:last-child'));
  const edited = document.activeElement as HTMLElement;
  edited.textContent = 'Keep this edit';

  const canvas = container.querySelector<HTMLCanvasElement>('.ink-canvas')!;
  const pointer = (type: string, clientX = 132, clientY = 81) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
    Object.assign(event, { pointerId: 1, pointerType: 'touch', isPrimary: true, width: 48, height: 44 });
    act(() => canvas.dispatchEvent(event));
  };
  pointer('pointerdown');
  pointer('pointerup');
  expect(edited.hasAttribute('contenteditable')).toBe(false);
  expect(save).toHaveBeenLastCalledWith(expect.stringContaining('Keep this edit'));
  expect(container.querySelectorAll('[data-note-positioned]')).toHaveLength(2);

  Object.defineProperties(edited, { offsetWidth: { value: 96 }, offsetHeight: { value: 35 } });
  pointer('pointerdown', 45, 15);
  pointer('pointerup', 45, 15);
  expect(container.querySelector('[data-ink-ui="selection"]')?.textContent).toContain('Edit text');
  pointer('pointerdown');
  pointer('pointerup');
  expect(container.querySelector('[data-ink-ui="selection"]')).toBeNull();
  expect(container.querySelectorAll('[data-note-positioned]')).toHaveLength(2);

  pointer('pointerdown');
  // Dismissing contextual controls can shift the sheet before the finger lifts.
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 40, 0, 0));
  pointer('pointerup');
  const inserted = document.activeElement as HTMLElement;
  expect(inserted.dataset.notePositioned).toBe('true');
  expect(inserted.style.left).toBe('132px');
  expect(inserted.style.top).toBe('81px');

  for (let tap = 0; tap < 2; tap++) {
    for (const type of ['pointerdown', 'pointerup']) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 140, clientY: 130 });
      Object.assign(event, { pointerId: 2, pointerType: 'touch', isPrimary: true, width: 10, height: 10 });
      act(() => inserted.dispatchEvent(event));
    }
  }
  expect(inserted.hasAttribute('contenteditable')).toBe(false);
  expect(container.querySelector('[data-ink-ui="selection"]')?.textContent).toContain('Edit text');
  act(() => inserted.remove());

  pointer('pointerdown', 45, 55);
  pointer('pointerup', 45, 55);
  expect(inserted.isConnected).toBe(false);
  expect(container.querySelector('[data-ink-ui="selection"]')?.textContent).toContain('Edit text');

  act(() => editorRef.current?.editBox(edited));
  for (const [type, x, y] of [['pointerdown', 45, 55], ['pointermove', 160, 130], ['pointerup', 160, 130]] as const) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.assign(event, { pointerId: 3, pointerType: 'touch', isPrimary: true, width: 48, height: 44 });
    act(() => edited.dispatchEvent(event));
  }
  expect(edited.hasAttribute('contenteditable')).toBe(false);
  expect(edited.style.left).not.toBe('0px');
  expect(save).toHaveBeenLastCalledWith(expect.stringContaining('Keep this edit'));
  expect(onChangeStrokes).not.toHaveBeenCalled();
});
