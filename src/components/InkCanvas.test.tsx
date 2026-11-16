// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InkCanvas } from './InkCanvas';
import { TextEditor, type TextEditorRef } from './TextEditor';
import { CANVAS_BASE_SIZE } from '../utils/pageLayout';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onChangeStrokes = vi.fn();

function pointer(target: Element, type: string, x: number, y: number, pointerType = 'touch', buttons = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons });
  Object.assign(event, { pointerId: 1, pointerType, isPrimary: true, pressure: buttons ? 0.5 : 0 });
  act(() => target.dispatchEvent(event));
}

function touch(target: Element, type: string, x = 0, y = 0) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = type === 'touchend' ? [] : [{ clientX: x, clientY: y, identifier: 1, target }];
  Object.defineProperty(event, 'touches', { value: touches });
  act(() => target.dispatchEvent(event));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(1024);
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
  const paper = container.querySelector<HTMLElement>('.note-paper-scale')!;
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

it('scrolls a blank swipe and only sets the insertion point on a tap', () => {
  const viewport = container.querySelector<HTMLElement>('.note-desk')!;
  const canvas = container.querySelector<HTMLElement>('.ink-canvas')!;
  viewport.scrollLeft = viewport.scrollTop = 100;

  const chooseTool = (current: string, next: string) => {
    act(() => container.querySelector<HTMLButtonElement>(`button[title="Tool: ${current}"]`)!.click());
    const option = Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="Tools"] button'))
      .find((button) => button.textContent?.startsWith(next))!;
    act(() => option.click());
  };
  expect(container.querySelector('[aria-label="Pan with touch"]')).toBeNull();
  chooseTool('Text', 'Select');
  pointer(canvas, 'pointerdown', 150, 150);
  touch(canvas, 'touchstart', 150, 150);
  touch(canvas, 'touchmove', 113, 101);
  pointer(canvas, 'pointerup', 113, 101);
  touch(canvas, 'touchend');
  expect([viewport.scrollLeft, viewport.scrollTop]).toEqual([137, 149]);
  expect(container.querySelector('.note-paper svg')).toBeNull();
  expect(container.querySelector('.note-insertion-point')).toBeNull();
  pointer(canvas, 'pointerdown', 140, 140);
  pointer(canvas, 'pointerup', 140, 140);
  expect(container.querySelector<HTMLElement>('.note-insertion-point')?.style.left).toBe('140px');
  expect(onChangeStrokes).not.toHaveBeenCalled();

  chooseTool('Select', 'Text');
  pointer(canvas, 'pointerdown', 160, 170);
  pointer(canvas, 'pointerup', 160, 170);
  expect(container.querySelector<HTMLElement>('.note-insertion-point')?.style.left).toBe('160px');
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

it('opens Insert and places a new box only when requested at the marked canvas coordinates', () => {
  const editorRef = createRef<TextEditorRef>();
  const save = vi.fn();
  const note = { id: 'scratch', title: 'Scratch', content: '<p>Existing text</p>', inkStrokes: [],
    tags: [], color: '', createdAt: 0, updatedAt: 0 };
  act(() => root.render(<InkCanvas noteId={note.id} defaultTool="pen" strokes={note.inkStrokes}
    onChangeStrokes={onChangeStrokes} onScribbleToText={() => {}} onChangeBackground={() => {}}
    textEditor={editorRef}
    textLayer={<TextEditor ref={editorRef} note={note} onChangeContent={save} embedded />} />));

  expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Insert');
  const clickTextBox = () => {
    const button = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Text Box')!;
    act(() => button.click());
  };
  clickTextBox();
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
  pointer('pointerdown', 45, 15);
  pointer('pointerup', 45, 15);
  expect(container.querySelector('[data-ink-ui="selection"]')).toBeNull();
  pointer('pointerdown', 45, 15);
  pointer('pointerup', 45, 15);
  pointer('pointerdown');
  pointer('pointerup');
  expect(container.querySelector('[data-ink-ui="selection"]')).toBeNull();
  expect(container.querySelectorAll('[data-note-positioned]')).toHaveLength(2);

  pointer('pointerdown');
  // Dismissing contextual controls can shift the sheet before the finger lifts.
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 40, 0, 0));
  pointer('pointerup');
  expect(container.querySelectorAll('[data-note-positioned]')).toHaveLength(2);
  expect(container.querySelector('[contenteditable="true"]')).toBeNull();
  expect(container.querySelector<HTMLElement>('.note-insertion-point')?.style.top).toBe('81px');
  clickTextBox();
  const inserted = document.activeElement as HTMLElement;
  expect(inserted.dataset.notePositioned).toBe('true');
  expect(inserted.style.left).toBe('132px');
  expect(inserted.style.top).toBe('81px');
  expect(container.querySelector('.note-insertion-point')).toBeNull();

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
  const viewport = container.querySelector<HTMLElement>('.note-desk')!;
  viewport.scrollTop = 100;
  const originalLeft = edited.style.left;
  const swipe = (type: string, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 45, clientY: y });
    Object.assign(event, { pointerType: 'touch', isPrimary: true, pointerId: 3 });
    act(() => edited.dispatchEvent(event));
  };
  swipe('pointerdown', 55);
  touch(edited, 'touchstart', 45, 55);
  touch(edited, 'touchmove', 45, 25);
  swipe('pointerup', 25);
  touch(edited, 'touchend');
  expect(viewport.scrollTop).toBe(130);
  expect(edited.hasAttribute('contenteditable')).toBe(true);
  expect(edited.style.left).toBe(originalLeft);
  expect(save).toHaveBeenLastCalledWith(expect.stringContaining('Keep this edit'));
  expect(onChangeStrokes).not.toHaveBeenCalled();
});

it('shows mouse hover handles, moves the box, and opens it for editing on double-click', () => {
  const editorRef = createRef<TextEditorRef>();
  const note = { id: 'scratch', title: 'Scratch', content: '<p>Existing text</p>', inkStrokes: [],
    tags: [], color: '', createdAt: 0, updatedAt: 0 };
  act(() => root.render(<InkCanvas noteId={note.id} strokes={[]} onChangeStrokes={onChangeStrokes}
    onScribbleToText={() => {}} textEditor={editorRef}
    textLayer={<TextEditor ref={editorRef} note={note} onChangeContent={() => {}} embedded />} />));
  const box = container.querySelector<HTMLElement>('[data-note-positioned]')!;
  Object.defineProperties(box, {
    offsetWidth: { value: 100 }, offsetHeight: { value: 40 },
    offsetLeft: { get: () => parseFloat(box.style.left) || 0 },
    offsetTop: { get: () => parseFloat(box.style.top) || 0 },
  });
  const canvas = container.querySelector('.ink-canvas')!;
  const frame = () => container.querySelector('[data-ink-ui="selection"]');
  pointer(box, 'pointermove', 40, 20, 'mouse');
  expect(frame()?.querySelector('[aria-label="Resize selection"]')).not.toBeNull();
  pointer(canvas, 'pointermove', 150, 150, 'mouse');
  expect(frame()).toBeNull();
  pointer(box, 'pointerdown', 40, 20, 'mouse', 1);
  pointer(box, 'pointermove', 90, 80, 'mouse', 1);
  pointer(box, 'pointerup', 90, 80, 'mouse');
  expect(box.style.left).toBe('50px');
  expect(box.style.top).toBe('60px');
  act(() => box.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 90, clientY: 80 })));
  expect(document.activeElement).toBe(box);
  expect(frame()).toBeNull();
});

it.each([
  ['Table', true, '132px', '81px'],
  ['Table', false, '277px', '542px'],
  ['Picture', true, '132px', '81px'],
  ['Picture', false, '257px', '492px'],
] as const)('inserts %s at the marked point when marked is %s', async (kind, marked, left, top) => {
  const editorRef = createRef<TextEditorRef>();
  const note = { id: 'scratch', title: 'Scratch', content: '', inkStrokes: [],
    tags: [], color: '', createdAt: 0, updatedAt: 0 };
  let onSave!: (content: string) => void;
  const saved = new Promise<string>((resolve) => { onSave = resolve; });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.matches('[data-note-table]') ? 240 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.matches('[data-note-table]') ? 40 : 0;
  });
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(200);
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(100);
  act(() => root.render(<InkCanvas noteId={note.id} strokes={[]} onChangeStrokes={onChangeStrokes}
    onScribbleToText={() => {}} onChangeBackground={() => {}} textEditor={editorRef}
    textLayer={<TextEditor ref={editorRef} note={note} onChangeContent={onSave} embedded />} />));

  if (marked) {
    const canvas = container.querySelector('.ink-canvas')!;
    pointer(canvas, 'pointerdown', 132, 81, 'mouse', 1);
    pointer(canvas, 'pointerup', 132, 81, 'mouse');
    expect(container.querySelector('.note-insertion-point')).not.toBeNull();
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
  }
  if (kind === 'Table') {
    const tableButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Table')!;
    act(() => tableButton.click());
    const form = container.querySelector('form.ribbon-table-form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await saved; });
  } else {
    const input = container.querySelector<HTMLInputElement>('.note-ribbon input[accept^="image/"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['image'], 'image.png', { type: 'image/png' })] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await saved; });
  }
  const object = container.querySelector<HTMLElement>(kind === 'Table' ? '[data-note-table]' : '[data-note-editor] img')!;
  expect(object.style.left).toBe(left);
  expect(object.style.top).toBe(top);
  expect(container.querySelector('.note-insertion-point')).toBeNull();
});

it('switches from Text to Draw on the first pen contact and records that stroke', () => {
  const editorRef = createRef<TextEditorRef>();
  act(() => root.render(<InkCanvas noteId="scratch" defaultTool="pen" strokes={[]} textEditor={editorRef}
    onChangeBackground={() => {}} onScribbleToText={() => {}} onChangeStrokes={onChangeStrokes} />));
  const canvas = container.querySelector('.ink-canvas')!;
  const activeTab = () => container.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
  expect(container.querySelector('[aria-label="Text tool"]')?.getAttribute('aria-pressed')).toBe('true');
  pointer(canvas, 'pointermove', 30, 30, 'pen');
  expect(activeTab()).toBe('Insert');
  pointer(canvas, 'pointerdown', 30, 30, 'pen', 1);
  expect(activeTab()).toBe('Draw');
  pointer(canvas, 'pointermove', 60, 60, 'pen', 1);
  pointer(canvas, 'pointerup', 60, 60, 'pen');
  expect(onChangeStrokes).toHaveBeenCalledWith([expect.objectContaining({ tool: 'pen' })]);
});

it.each(['clipboard API', 'iPad system Paste', 'blocked clipboard fallback'])('places a pasted image at the chosen point via %s', async (method) => {
  const editorRef = createRef<TextEditorRef>();
  const note = { id: 'scratch', title: 'Scratch', content: '', inkStrokes: [],
    tags: [], color: '', createdAt: 0, updatedAt: 0 };
  let saved!: (content: string) => void;
  const save = new Promise<string>((resolve) => { saved = resolve; });
  act(() => root.render(<InkCanvas noteId={note.id} strokes={[]} onChangeStrokes={onChangeStrokes}
    onScribbleToText={() => {}} textEditor={editorRef}
    textLayer={<TextEditor ref={editorRef} note={note} onChangeContent={saved} embedded />} />));
  const canvas = container.querySelector('.ink-canvas')!;
  const menu = () => container.querySelector<HTMLButtonElement>('[data-ink-ui="paste-image"]');
  act(() => canvas.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: 100, clientY: 130,
  })));
  expect(menu()?.textContent).toContain('Paste image');
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(menu()).toBeNull();
  vi.useFakeTimers();
  try {
    pointer(canvas, 'pointerdown', 120, 160);
    act(() => vi.advanceTimersByTime(500));
    pointer(canvas, 'pointerup', 120, 160);
    expect(menu()).not.toBeNull();
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
  } finally {
    vi.useRealTimers();
  }
  const webKit = method === 'iPad system Paste';
  vi.stubGlobal('CSS', { supports: (property: string) => webKit && property === '-webkit-touch-callout' });
  const filename = 'clipboard.png';
  const imageFile = new File(['image'], filename, { type: 'image/png' });
  const read = vi.fn(async () => {
    if (method === 'blocked clipboard fallback') throw new DOMException('Blocked', 'NotAllowedError');
    return [{ types: [imageFile.type], getType: async () => imageFile }];
  });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read } });
  const execCommand = vi.fn(() => {
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Paste image here');
    return false;
  });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
  try {
    if (method === 'clipboard API') {
      await act(async () => { menu()!.click(); await save; });
    } else {
      await act(async () => menu()!.click());
      const target = container.querySelector('[aria-label="Paste image here"]')!;
      expect(target).toBe(document.activeElement);
      const paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', {
        value: webKit
          ? { files: [], items: [{ kind: 'file', type: imageFile.type, getAsFile: () => imageFile }] }
          : { files: [imageFile], items: [] },
      });
      await act(async () => { target.dispatchEvent(paste); await save; });
      expect(paste.defaultPrevented).toBe(true);
      expect(target.isConnected).toBe(false);
    }
    expect(read).toHaveBeenCalledTimes(webKit ? 0 : 1);
    if (webKit) expect(execCommand).toHaveBeenCalledWith('paste');
    else expect(execCommand).not.toHaveBeenCalled();
    const image = container.querySelector<HTMLImageElement>('[data-note-editor] img')!;
    expect(image.style.left).toBe('120px');
    expect(image.style.top).toBe('160px');
  } finally {
    Reflect.deleteProperty(navigator, 'clipboard');
    Reflect.deleteProperty(document, 'execCommand');
  }
});

it('opens the endless canvas on a workspace larger than the A4 sheet', () => {
  act(() => root.render(<InkCanvas noteId="scratch" pageLayout="canvas" defaultTool="pen"
    strokes={[]} onChangeStrokes={onChangeStrokes} onScribbleToText={() => {}} />));

  const paper = container.querySelector<HTMLElement>('.note-paper')!;
  expect(paper.dataset.layout).toBe('canvas');
  expect(paper.style.width).toBe(`${CANVAS_BASE_SIZE.width}px`);
  expect(paper.style.minHeight).toBe(`${CANVAS_BASE_SIZE.height}px`);
  expect(container.querySelector('.note-page-footer')).toBeNull();
});

it('zooms the endless canvas with a plain mouse wheel', () => {
  act(() => root.render(<InkCanvas noteId="scratch" pageLayout="canvas" defaultTool="pen"
    strokes={[]} onChangeStrokes={onChangeStrokes} onScribbleToText={() => {}} />));

  const viewport = container.querySelector<HTMLElement>('.note-desk')!;
  const scaleTransform = () => container.querySelector<HTMLElement>('.note-paper-scale')!.style.transform;

  const zoomIn = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, clientX: 200, clientY: 200 });
  act(() => viewport.dispatchEvent(zoomIn));
  expect(zoomIn.defaultPrevented).toBe(true);
  expect(scaleTransform()).not.toBe('scale(1)');
  const zoomed = scaleTransform();

  const zoomOut = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100, clientX: 200, clientY: 200 });
  act(() => viewport.dispatchEvent(zoomOut));
  expect(scaleTransform()).not.toBe(zoomed);
});

it('leaves a plain mouse wheel to scroll A4 pages', () => {
  act(() => root.render(<InkCanvas noteId="scratch" pageLayout="portrait" defaultTool="pen"
    strokes={[]} onChangeStrokes={onChangeStrokes} onScribbleToText={() => {}} />));

  const viewport = container.querySelector<HTMLElement>('.note-desk')!;
  const scale = container.querySelector<HTMLElement>('.note-paper-scale')!.style.transform;
  const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 });
  act(() => viewport.dispatchEvent(wheel));
  expect(wheel.defaultPrevented).toBe(false);
  expect(container.querySelector<HTMLElement>('.note-paper-scale')!.style.transform).toBe(scale);
});
