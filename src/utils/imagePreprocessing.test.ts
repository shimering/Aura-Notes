import { describe, it, expect } from 'vitest';
import { cleanRecognizedText } from './imagePreprocessing';

describe('Text & Image Preprocessing', () => {
  it('cleans up raw OCR text and normalizes whitespace', () => {
    const raw = '  Hello   World \n\n  This is a   test   ';
    const cleaned = cleanRecognizedText(raw);
    expect(cleaned).toBe('Hello World\n\nThis is a test');
  });

  it('removes stray OCR artifacts while preserving genuine words', () => {
    const raw = '|   Meeting notes for Monday  ~  ';
    const cleaned = cleanRecognizedText(raw);
    expect(cleaned).toContain('Meeting notes for Monday');
  });
});
