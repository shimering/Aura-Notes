import { createWorker, Worker } from 'tesseract.js';
import { cleanRecognizedText } from '../utils/imagePreprocessing';

let cachedWorker: Worker | null = null;
let isWorkerInitializing = false;

/**
 * Initializes and caches the client-side Tesseract.js OCR worker.
 */
async function getWorker(onProgress?: (progress: number, status: string) => void): Promise<Worker> {
  if (cachedWorker) {
    return cachedWorker;
  }

  isWorkerInitializing = true;
  try {
    const worker = await createWorker('eng', 1, {
      logger: (m) => {
        if (onProgress && m.status && typeof m.progress === 'number') {
          onProgress(m.progress, m.status);
        }
      }
    });

    cachedWorker = worker;
    isWorkerInitializing = false;
    return worker;
  } catch (error) {
    isWorkerInitializing = false;
    console.error('Failed to initialize Tesseract worker:', error);
    throw error;
  }
}

export interface OCRRecognitionOptions {
  geminiApiKey?: string;
  onProgress?: (progress: number, status: string) => void;
}

/**
 * Recognizes handwriting from a preprocessed Canvas element or image data URL.
 * Automatically attempts client-side Tesseract OCR, with optional AI cloud transcription.
 */
export async function recognizeHandwriting(
  canvas: HTMLCanvasElement,
  options: OCRRecognitionOptions = {}
): Promise<{ text: string; source: 'tesseract' | 'gemini' }> {
  const { geminiApiKey, onProgress } = options;

  // If Gemini API Key is provided, use multimodal Gemini for superior transcription
  if (geminiApiKey && geminiApiKey.trim().length > 10) {
    try {
      if (onProgress) onProgress(0.3, 'Calling Gemini AI Handwriting Engine...');
      const dataUrl = canvas.toDataURL('image/png');
      const base64Data = dataUrl.replace(/^data:image\/(png|jpeg);base64,/, '');

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: 'You are an accurate handwriting recognition system. Transcribe the handwriting in this image into clean formatted text or markdown. Output ONLY the transcribed text, without any introductory or concluding comments.'
                  },
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: base64Data
                    }
                  }
                ]
              }
            ]
          })
        }
      );

      if (!response.ok) {
        throw new Error(`Gemini API returned status ${response.status}`);
      }

      const json = await response.json();
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text && text.trim().length > 0) {
        if (onProgress) onProgress(1.0, 'Complete');
        return { text: text.trim(), source: 'gemini' };
      }
    } catch (err) {
      console.warn('Gemini transcription failed, falling back to local Tesseract OCR:', err);
    }
  }

  // Fallback to client-side offline Tesseract OCR
  if (onProgress) onProgress(0.1, 'Loading offline OCR engine...');
  const worker = await getWorker(onProgress);

  if (onProgress) onProgress(0.5, 'Recognizing handwritten strokes...');
  const result = await worker.recognize(canvas);

  const rawText = result.data.text || '';
  const cleaned = cleanRecognizedText(rawText);

  if (onProgress) onProgress(1.0, 'Done');
  return {
    text: cleaned,
    source: 'tesseract'
  };
}
