import { describe, it, expect, beforeEach } from 'vitest';
import { InkHistory } from './inkHistory';
import { Stroke } from '../types/note';

function stroke(id: string): Stroke {
  return {
    id,
    points: [{ x: 0, y: 0, pressure: 0.5, time: 0 }],
    color: '#000000',
    width: 4,
    tool: 'fountain'
  };
}

describe('InkHistory', () => {
  let history: InkHistory;

  beforeEach(() => {
    history = new InkHistory(3);
  });

  it('starts empty and ignores identity commits', () => {
    const a = [stroke('a')];
    history.commit(a, a);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it('undoes and redoes committed snapshots', () => {
    const a: Stroke[] = [];
    const b = [stroke('1')];
    const c = [stroke('1'), stroke('2')];

    history.commit(a, b);
    history.commit(b, c);
    expect(history.canUndo).toBe(true);

    const afterUndo = history.undo(c);
    expect(afterUndo).toBe(b);
    expect(history.canRedo).toBe(true);

    const afterRedo = history.redo(b!);
    expect(afterRedo).toBe(c);
    expect(history.canRedo).toBe(false);
  });

  it('makes a destructive erase undoable', () => {
    const drawn = [stroke('1'), stroke('2')];
    const erased: Stroke[] = [stroke('2')];

    history.commit(drawn, erased);
    const restored = history.undo(erased);
    expect(restored).toBe(drawn);
    expect(restored).toHaveLength(2);
  });

  it('invalidates the redo branch after a new edit', () => {
    const a: Stroke[] = [];
    const b = [stroke('1')];
    const c = [stroke('2')];

    history.commit(a, b);
    history.undo(b);
    expect(history.canRedo).toBe(true);

    history.commit(a, c);
    expect(history.canRedo).toBe(false);
  });

  it('caps stored snapshots at the configured limit', () => {
    let current: Stroke[] = [];
    for (let i = 0; i < 5; i++) {
      const next = [...current, stroke(String(i))];
      history.commit(current, next);
      current = next;
    }

    let undoCount = 0;
    while (history.canUndo) {
      const prev = history.undo(current);
      if (!prev) break;
      current = prev;
      undoCount++;
    }
    expect(undoCount).toBe(3);
  });

  it('reset clears both stacks', () => {
    const a: Stroke[] = [];
    history.commit(a, [stroke('1')]);
    history.undo([stroke('1')]);
    history.reset();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });
});
