import { describe, it, expect } from 'vitest';
import { 
  isSpenBarrelOrEraser, 
  isSpenHoverButtonPressed,
  isSpenHardwareKeyEvent,
  evaluateSpenButtonAction,
  toggleSpenHoverTool
} from './spenDetection';

describe('S Pen Detection Utilities', () => {
  it('correctly identifies S Pen barrel button bitmasks and button IDs on Android Chrome and Windows', () => {
    // Normal tip touch (buttons = 1, button = 0) -> false
    expect(isSpenBarrelOrEraser(1, 0)).toBe(false);

    // Android Chrome S Pen button mapping (button = 1 / buttons & 4 = true)
    expect(isSpenBarrelOrEraser(4)).toBe(true);
    expect(isSpenBarrelOrEraser(0, 1)).toBe(true);

    // Secondary button hovering (buttons = 2 / button = 2)
    expect(isSpenBarrelOrEraser(2)).toBe(true);
    expect(isSpenBarrelOrEraser(0, 2)).toBe(true);

    // Eraser tip (buttons = 32 / button = 5)
    expect(isSpenBarrelOrEraser(32)).toBe(true);
    expect(isSpenBarrelOrEraser(0, 5)).toBe(true);
  });

  it('detects S Pen button press while hovering in mid-air', () => {
    // Hovering with no button pressed
    expect(isSpenHoverButtonPressed(0, -1, 0)).toBe(false);
    expect(isSpenHoverButtonPressed(0, 0, 0)).toBe(false);

    // Hovering with barrel button pressed in the air
    expect(isSpenHoverButtonPressed(4, -1, 0)).toBe(true);
    expect(isSpenHoverButtonPressed(2, -1, 0)).toBe(true);
    expect(isSpenHoverButtonPressed(32, -1, 0)).toBe(true);
    expect(isSpenHoverButtonPressed(1, -1, 0)).toBe(true);
    expect(isSpenHoverButtonPressed(0, 1, 0)).toBe(true);
    expect(isSpenHoverButtonPressed(0, 2, 0)).toBe(true);
  });

  it('identifies Android 14+ Stylus hardware key events', () => {
    expect(isSpenHardwareKeyEvent({ keyCode: 308 } as KeyboardEvent)).toBe(true);
    expect(isSpenHardwareKeyEvent({ keyCode: 309 } as KeyboardEvent)).toBe(true);
    expect(isSpenHardwareKeyEvent({ code: 'StylusButtonPrimary' } as KeyboardEvent)).toBe(true);
    expect(isSpenHardwareKeyEvent({ keyCode: 65 } as KeyboardEvent)).toBe(false);
  });

  it('correctly classifies "Keep pressing" hold vs "Press once" single click', () => {
    expect(evaluateSpenButtonAction(120, false, false, 250)).toBe('single-click-menu');
    expect(evaluateSpenButtonAction(150, true, false, 250)).toBe('hold-eraser');
    expect(evaluateSpenButtonAction(300, false, false, 250)).toBe('hold-eraser');
    expect(evaluateSpenButtonAction(100, false, true, 250)).toBe('hold-eraser');
  });

  it('toggles tool cleanly on S Pen hover button press', () => {
    const toEraser = toggleSpenHoverTool('fountain', undefined);
    expect(toEraser.nextTool).toBe('eraser');
    expect(toEraser.savedPriorTool).toBe('fountain');

    const backToPen = toggleSpenHoverTool('eraser', 'fountain');
    expect(backToPen.nextTool).toBe('fountain');
  });
});
