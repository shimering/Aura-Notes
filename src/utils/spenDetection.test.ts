import { describe, it, expect } from 'vitest';
import { 
  isSpenBarrelOrEraser, 
  isSpenButtonPressed,
  isSpenHardwareKeyEvent,
  evaluateSpenButtonAction,
  toggleSpenHoverTool
} from './spenDetection';

describe('S Pen Detection Utilities', () => {
  it('correctly identifies S Pen barrel button bitmasks and button IDs on Android Chrome and Windows', () => {
    // Normal tip touch (buttons = 1, button = 0) -> false
    expect(isSpenBarrelOrEraser(1, 0)).toBe(false);

    // Released button (buttons = 0, even if button = 1 on pointerup) -> false
    expect(isSpenBarrelOrEraser(0, 1)).toBe(false);

    // Android Chrome S Pen button mapping (buttons & 4 = true)
    expect(isSpenBarrelOrEraser(4, 1)).toBe(true);

    // Secondary button hovering (buttons = 2 / button = 2)
    expect(isSpenBarrelOrEraser(2, 2)).toBe(true);

    // Eraser tip (buttons = 32 / button = 5)
    expect(isSpenBarrelOrEraser(32, 5)).toBe(true);
  });

  it('detects S Pen button press while hovering in mid-air and releases instantly when buttons === 0', () => {
    // Hovering with no button pressed
    expect(isSpenButtonPressed(0, -1, 0)).toBe(false);
    expect(isSpenButtonPressed(0, 0, 0)).toBe(false);

    // Released in mid-air (pointerup reports buttons: 0, button: 1) -> MUST BE FALSE!
    expect(isSpenButtonPressed(0, 1, 0)).toBe(false);
    expect(isSpenButtonPressed(0, 2, 0)).toBe(false);

    // Hovering with barrel button pressed in the air
    expect(isSpenButtonPressed(4, -1, 0)).toBe(true);
    expect(isSpenButtonPressed(2, -1, 0)).toBe(true);
    expect(isSpenButtonPressed(32, -1, 0)).toBe(true);
    expect(isSpenButtonPressed(1, -1, 0)).toBe(true);
  });

  it('NEVER mistakes normal screen touch contact for an S Pen button press', () => {
    // Normal touch inking on screen (pressure > 0.05, buttons = 1, button = 0)
    expect(isSpenButtonPressed(1, 0, 0.4)).toBe(false);
    expect(isSpenButtonPressed(1, 0, 0.8)).toBe(false);
    expect(isSpenButtonPressed(1, -1, 0.5)).toBe(false);

    // Screen contact WITH S Pen button held down
    expect(isSpenButtonPressed(5, 0, 0.5)).toBe(true); // 1 (tip) | 4 (barrel)
    expect(isSpenButtonPressed(3, 0, 0.5)).toBe(true); // 1 (tip) | 2 (secondary)
    expect(isSpenButtonPressed(33, 0, 0.5)).toBe(true); // 1 (tip) | 32 (stylus primary)
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
