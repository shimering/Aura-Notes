import { PenTool } from '../types/note';

/**
 * Utilities for Samsung S Pen, Apple Pencil and Wacom Stylus pointer event handling
 */

/**
 * Checks if the pointer event has the barrel button (side button) or eraser button pressed.
 * - buttons & 4: W3C auxiliary / middle button (Chromium on Android / Samsung Galaxy Tab S Pen mapping!)
 * - buttons & 2: W3C secondary / barrel button (Windows / Wacom / Surface Pen)
 * - buttons & 32: W3C eraser tip / barrel eraser
 * - button === 1: Android Chrome S Pen side button click
 * - button === 2: Secondary button click
 * - button === 5: Eraser button click
 */
export function isSpenBarrelOrEraser(buttons: number, button?: number): boolean {
  return (
    (buttons & 4) !== 0 ||
    (buttons & 2) !== 0 ||
    (buttons & 32) !== 0 ||
    button === 1 ||
    button === 2 ||
    button === 5
  );
}

/**
 * Evaluates whether an S Pen button interaction was a "Keep Pressing" (Hold to Erase)
 * or a "Press Once" (Single Click to open Pen & Color Menu).
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

/**
 * Toggles the active pen tool when the S Pen button is pressed while hovering.
 * Seamlessly flips between the user's active pen (e.g. fountain or ballpoint) and eraser.
 */
export function toggleSpenHoverTool(
  currentTool: PenTool,
  priorTool?: PenTool
): { nextTool: PenTool; savedPriorTool: PenTool; label: string } {
  if (currentTool === 'eraser') {
    const next = priorTool || 'fountain';
    return {
      nextTool: next,
      savedPriorTool: next,
      label: next === 'fountain' ? 'Fountain Pen' : next === 'highlighter' ? 'Highlighter' : 'Ballpoint Pen'
    };
  }

  return {
    nextTool: 'eraser',
    savedPriorTool: currentTool,
    label: 'Eraser'
  };
}
