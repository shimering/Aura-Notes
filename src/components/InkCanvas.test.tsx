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
  const note = { id: 'scratch', title: 'Scratch', content: '<p>Existing text</p>', inkStrokes: [],
    tags: [], color: '', createdAt: 0, updatedAt: 0 };
  act(() => root.render(<InkCanvas noteId={note.id} defaultTool="pen" strokes={note.inkStrokes}
    onChangeStrokes={onChangeStrokes} onScribbleToText={() => {}} onChangeBackground={() => {}}
    textEditor={editorRef}
    textLayer={<TextEditor ref={editorRef} note={note} onChangeContent={() => {}} embedded />} />));

  expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Insert');
  const textBoxButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Text Box');
  act(() => textBoxButton?.click());
  expect(container.querySelectorAll('[data-note-positioned]')).toHaveLength(2);
  expect(document.activeElement).toBe(container.querySelector('[data-note-positioned]:last-child'));

  const canvas = container.querySelector<HTMLCanvasElement>('.ink-canvas')!;
  const pointer = (type: string) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 132, clientY: 81 });
    Object.assign(event, { pointerId: 1, pointerType: 'touch', isPrimary: true, width: 10, height: 10 });
    act(() => canvas.dispatchEvent(event));
  };
  pointer('pointerdown');
  // Dismissing contextual controls can shift the sheet before the finger lifts.
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 40, 0, 0));
  pointer('pointerup');
  const inserted = document.activeElement as HTMLElement;
  expect(inserted.dataset.notePositioned).toBe('true');
  expect(inserted.style.left).toBe('132px');
  expect(inserted.style.top).toBe('81px');
  expect(onChangeStrokes).not.toHaveBeenCalled();
});
