// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useKeyboardViewport } from './useKeyboardViewport';

function Editor() {
  const keyboardOpen = useKeyboardViewport();
  return <input aria-label="Note title" data-keyboard-open={keyboardOpen} />;
}

it('restores the document after WebKit reports a keyboard dismissal before updating its viewport height', () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('navigator', { maxTouchPoints: 5 });
  vi.stubGlobal('CSS', { supports: () => true });
  const viewport = Object.assign(new EventTarget(), {
    height: window.innerHeight,
    scale: 1,
    offsetTop: 0,
  });
  vi.stubGlobal('visualViewport', viewport);

  const scroller = document.documentElement;
  Object.defineProperty(document, 'scrollingElement', { configurable: true, value: scroller });
  const container = document.createElement('div');
  container.id = 'root';
  document.body.append(container);
  const root = createRoot(container);

  try {
    act(() => root.render(<Editor />));
    const input = container.querySelector('input')!;
    act(() => {
      input.focus();
      viewport.height = window.innerHeight - 260;
      viewport.offsetTop = 85;
      viewport.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(32);
    });
    expect(input.dataset.keyboardOpen).toBe('true');
    expect(container.style.getPropertyValue('--app-top')).toBe('85px');

    scroller.scrollTop = 85;
    act(() => {
      viewport.dispatchEvent(new Event('resize'));
      viewport.height = window.innerHeight;
      viewport.offsetTop = 0;
      vi.advanceTimersByTime(48);
    });
    expect(input.dataset.keyboardOpen).toBe('false');
    expect(container.dataset.keyboardOpen).toBeUndefined();
    expect(container.style.getPropertyValue('--app-height')).toBe('');
    expect(scroller.scrollTop).toBe(0);
    expect(document.activeElement).toBe(input);
  } finally {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(document, 'scrollingElement');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
