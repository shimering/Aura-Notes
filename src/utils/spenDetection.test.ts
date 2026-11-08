import { describe, it, expect } from 'vitest';
import { 
  isSpenBarrelOrEraser, 
  evaluateSpenButtonAction,
  toggleSpenHoverTool
} from './spenDetection';

describe('S Pen Detection Utilities', () => {
  it('correctly identifies S Pen barrel button bitmasks and button IDs', () => {
    // Normal tip touch (buttons = 1) -> false
    expect(isSpenBarrelOrEraser(1, 0)).toBe(false);

    // Barrel button hovering (buttons = 2) -> true
    expect(isSpenBarrelOrEraser(2)).toBe(true);

    // Barrel button touching glass (buttons = 1 + 2 = 3) -> true
    expect(isSpenBarrelOrEraser(3)).toBe(true);

    // Eraser tip or barrel eraser (buttons = 32 or 33) -> true
    expect(isSpenBarrelOrEraser(32)).toBe(true);
    expect(isSpenBarrelOrEraser(33)).toBe(true);

    // Pointer event with button = 2 or 5 -> true
    expect(isSpenBarrelOrEraser(0, 2)).toBe(true);
    expect(isSpenBarrelOrEraser(0, 5)).toBe(true);
  });

  it('correctly classifies "Keep pressing" hold vs "Press once" single click', () => {
    // Quick click without movement (< 250ms) -> single click menu
    expect(evaluateSpenButtonAction(120, false, false, 250)).toBe('single-click-menu');

    // Quick press but user dragged to erase strokes -> hold eraser
    expect(evaluateSpenButtonAction(150, true, false, 250)).toBe('hold-eraser');

    // Long press (>= 250ms) -> hold eraser
    expect(evaluateSpenButtonAction(300, false, false, 250)).toBe('hold-eraser');

    // Already marked as holding -> hold eraser
    expect(evaluateSpenButtonAction(100, false, true, 250)).toBe('hold-eraser');
  });

  it('toggles tool cleanly on S Pen hover button press', () => {
    // When pen is active, clicking S Pen button while hovering switches to eraser
    const toEraser = toggleSpenHoverTool('fountain', undefined);
    expect(toEraser.nextTool).toBe('eraser');
    expect(toEraser.savedPriorTool).toBe('fountain');

    // When eraser is active, clicking S Pen button while hovering switches back to pen
    const backToPen = toggleSpenHoverTool('eraser', 'fountain');
    expect(backToPen.nextTool).toBe('fountain');
  });
});
