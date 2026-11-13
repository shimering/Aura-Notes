import { Stroke } from '../types/note';

/**
 * Snapshot-based undo/redo history for ink strokes.
 *
 * Every committed change stores the full previous stroke array. This is cheap
 * relative to the note size (arrays of references) and makes both drawing and
 * destructive erasing fully undoable and persistent.
 */
export class InkHistory {
  private past: Stroke[][] = [];
  private future: Stroke[][] = [];

  constructor(private readonly limit: number = 100) {}

  /** Clears all history, e.g. when switching to another note. */
  reset(): void {
    this.past = [];
    this.future = [];
  }

  /**
   * Records a transition from `previous` to `next`.
   * No-op when both reference the same array.
   */
  commit(previous: Stroke[], next: Stroke[]): void {
    if (previous === next) return;

    this.past.push(previous);
    if (this.past.length > this.limit) {
      this.past.splice(0, this.past.length - this.limit);
    }
    // A new edit invalidates any redo branch.
    this.future = [];
  }

  /** Returns the previous snapshot, or null when there is nothing to undo. */
  undo(current: Stroke[]): Stroke[] | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(current);
    return previous;
  }

  /** Returns the next snapshot, or null when there is nothing to redo. */
  redo(current: Stroke[]): Stroke[] | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
