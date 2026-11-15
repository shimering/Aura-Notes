// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpenGesture } from './spenGesture';

function recognizer() {
  const onEraser = vi.fn();
  const onDoublePress = vi.fn();
  return Object.assign(createSpenGesture({ holdMs: () => 250, onEraser, onDoublePress }), { onEraser, onDoublePress });
}

const sample = (buttons: number, pressure: number, button = -1) => ({ buttons, pressure, button });
const advance = (ms: number) => vi.advanceTimersByTime(ms);

describe('S Pen side button gesture', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it('does not switch tools for light tip contact or the stale primary bit on lift', () => {
    const g = recognizer();
    g.pointer('down', sample(1, 0, 0));
    g.pointer('move', sample(1, 0.02));
    g.pointer('move', sample(1, 0));
    g.pointer('move', sample(1, 0));
    advance(300);
    g.pointer('up', sample(0, 0, 0));
    g.pointer('move', sample(1, 0));
    g.pointer('move', sample(1, 0));
    advance(300);
    expect(g.onEraser).not.toHaveBeenCalled();
    expect(g.onDoublePress).not.toHaveBeenCalled();
  });

  it('opens the palette on two quick barrel clicks without arming the eraser', () => {
    const g = recognizer();
    for (let click = 0; click < 2; click++) {
      g.pointer('down', sample(4, 0, 1));
      advance(85);
      g.pointer('up', sample(0, 0, 1));
      expect(g.onDoublePress).toHaveBeenCalledTimes(click);
      advance(140);
    }
    expect(g.onEraser).not.toHaveBeenCalled();
  });

  it('keeps erasing across hover, contact and lift until the button is released', () => {
    const g = recognizer();
    g.pointer('move', sample(4, 0, 1));
    advance(249);
    expect(g.onEraser).not.toHaveBeenCalled();
    advance(1);
    g.pointer('down', sample(5, 0.3, 0));
    g.pointer('up', sample(0, 0, 0));
    g.pointer('cancel', sample(0, 0));
    advance(120);
    g.pointer('move', sample(4, 0));
    expect(g.onEraser.mock.calls).toEqual([[true]]);
    g.pointer('up', sample(0, 0, 1));
    expect(g.onEraser.mock.calls).toEqual([[true], [false]]);
  });

  it('honors a side button press and release with the tip down', () => {
    const g = recognizer();
    g.pointer('down', sample(1, 0.3, 0));
    g.pointer('move', sample(3, 0.3, 2));
    advance(250);
    g.pointer('move', sample(1, 0.3, 2));
    expect(g.tipDown).toBe(true);
    expect(g.onEraser.mock.calls).toEqual([[true], [false]]);
  });

  it('debounces a missing contact bit and recognizes a sustained release', () => {
    const g = recognizer();
    g.pointer('down', sample(1, 0.3, 0));
    g.pointer('move', sample(5, 0.3));
    advance(250);
    g.pointer('move', sample(1, 0.3));
    advance(60);
    g.pointer('move', sample(5, 0.3));
    advance(90);
    expect(g.onEraser.mock.calls).toEqual([[true]]);
    g.pointer('move', sample(1, 0.3));
    advance(80);
    expect(g.onEraser.mock.calls).toEqual([[true], [false]]);
  });

  it('preserves a Samsung hover-only press when contact masks its primary bit', () => {
    const g = recognizer();
    g.pointer('move', sample(1, 0));
    g.pointer('move', sample(1, 0));
    advance(250);
    g.pointer('down', sample(1, 0.3, 0));
    g.pointer('move', sample(1, 0.3));
    g.pointer('up', sample(0, 0, 0));
    expect(g.onEraser.mock.calls).toEqual([[true]]);
    advance(110);
    g.pointer('move', sample(0, 0));
    expect(g.onEraser.mock.calls).toEqual([[true], [false]]);
  });

  it('waits for hardware keyup even when the pen tip is down', () => {
    const g = recognizer();
    g.keyDown();
    advance(250);
    g.pointer('down', sample(1, 0.4, 0));
    g.pointer('move', sample(1, 0.4));
    advance(250);
    expect(g.onEraser.mock.calls).toEqual([[true]]);
    g.keyUp();
    expect(g.onEraser.mock.calls).toEqual([[true], [false]]);
  });
});
