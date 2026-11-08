/**
 * Utilities for Samsung S Pen, Apple Pencil and Wacom Stylus pointer event handling
 */

/**
 * Checks if the pointer event has the barrel button (side button) or eraser button pressed.
 * - buttons & 2: W3C secondary / barrel button (standard on S Pen & Surface Pen)
 * - buttons & 32: W3C eraser tip / barrel eraser
 * - button === 2: secondary button click
 * - button === 5: eraser button click
 */
export function isSpenBarrelOrEraser(buttons: number, button?: number): boolean {
  return (buttons & 2) !== 0 || (buttons & 32) !== 0 || button === 2 || button === 5;
}

/**
 * Evaluates whether an S Pen button interaction was a "Keep Pressing" (Hold to Erase)
 * or a "Press Once" (Single Click to open Pen & Color Menu).
 *
 * @param pressDurationMs Duration in milliseconds that the button was down
 * @param hasErasedOrMoved Whether stylus drew or moved noticeably while button was down
 * @param isHolding Whether hold state was already triggered by timeout
 * @param holdThresholdMs Time threshold in ms (default 250ms)
 */
export function evaluateSpenButtonAction(
  pressDurationMs: number,
  hasErasedOrMoved: boolean,
  isHolding: boolean,
  holdThresholdMs: number = 250
): 'hold-eraser' | 'single-click-menu' {
  if (isHolding || hasErasedOrMoved || pressDurationMs >= holdThresholdMs) {
    return 'hold-eraser';
  }
  return 'single-click-menu';
}
