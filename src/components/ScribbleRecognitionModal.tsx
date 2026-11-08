import React, { useState, useEffect } from 'react';
import { 
  Wand2, 
  X, 
  Check, 
  Copy, 
  Key, 
  RotateCw, 
  ArrowRight, 
  FileText,
  Sparkles,
  AlertCircle
} from 'lucide-react';
import { recognizeHandwriting } from '../services/ocrService';
import { Stroke } from '../types/note';
import { getStrokesBoundingBox } from '../utils/inkSmoothing';
import { preprocessCanvasForOCR } from '../utils/imagePreprocessing';

interface ScribbleRecognitionModalProps {
  isOpen: boolean;
  onClose: () => void;
  strokes: Stroke[];
  canvasElement: HTMLCanvasElement | null;
  onInsertText: (text: string, clearStrokes: boolean) => void;
}

export const ScribbleRecognitionModal: React.FC<ScribbleRecognitionModalProps> = ({
  isOpen,
  onClose,
  strokes,
  canvasElement,
  onInsertText
}) => {
  const [recognizedText, setRecognizedText] = useState('');
  const [statusMessage, setStatusMessage] = useState('Initializing...');
  const [progress, setProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [clearStrokesAfter, setClearStrokesAfter] = useState(true);
  const [geminiKey, setGeminiKey] = useState(() => {
    return localStorage.getItem('aura_gemini_api_key') || '';
  });
  const [showSettings, setShowSettings] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);

  const startRecognition = async () => {
    if (!canvasElement || strokes.length === 0) return;

    setIsLoading(true);
    setProgress(0.1);
    setStatusMessage('Analyzing ink strokes...');

    try {
      // Calculate stroke bounding box
      const bbox = getStrokesBoundingBox(strokes);
      const preprocessed = preprocessCanvasForOCR(canvasElement, bbox);
      setPreviewDataUrl(preprocessed.toDataURL('image/png'));

      const result = await recognizeHandwriting(preprocessed, {
        geminiApiKey: geminiKey.trim(),
        onProgress: (p, msg) => {
          setProgress(p);
          setStatusMessage(msg);
        }
      });

      setRecognizedText(result.text || '(No text detected in strokes)');
      setStatusMessage(result.source === 'gemini' ? 'Transcribed with Gemini AI' : 'Recognized with Offline OCR');
    } catch (err: any) {
      console.error(err);
      setStatusMessage('Recognition failed. Please try again.');
      setRecognizedText('');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      startRecognition();
    } else {
      setRecognizedText('');
      setPreviewDataUrl(null);
    }
  }, [isOpen]);

  const handleCopy = () => {
    if (!recognizedText) return;
    navigator.clipboard.writeText(recognizedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInsert = () => {
    if (!recognizedText.trim()) return;
    onInsertText(recognizedText.trim(), clearStrokesAfter);
    onClose();
  };

  const handleSaveGeminiKey = (key: string) => {
    setGeminiKey(key);
    localStorage.setItem('aura_gemini_api_key', key);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-surface-light dark:bg-surface-dark rounded-3xl shadow-2xl border border-surface-subtle-light dark:border-surface-subtle-dark overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-5 border-b border-surface-subtle-light dark:border-surface-subtle-dark flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-violet-600 via-indigo-600 to-pink-500 flex items-center justify-center text-white shadow-sm">
              <Wand2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-base text-ink-light dark:text-ink-dark">
                Scribble to Text
              </h3>
              <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">
                Transcribe handwriting into formatted text
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-ink-muted-light hover:text-ink-light dark:text-ink-muted-dark dark:hover:text-ink-dark hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Progress / Status banner */}
          <div className="bg-surface-subtle-light dark:bg-surface-subtle-dark rounded-2xl p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-ink-light dark:text-ink-dark flex items-center gap-1.5">
                {isLoading && <RotateCw className="w-3.5 h-3.5 animate-spin text-violet-500" />}
                {statusMessage}
              </span>
              <span className="text-ink-muted-light dark:text-ink-muted-dark">
                {Math.round(progress * 100)}%
              </span>
            </div>
            {/* Progress Bar */}
            <div className="w-full h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-600 to-pink-500 transition-all duration-300 rounded-full"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          </div>

          {/* Stroke Preview Thumbnail */}
          {previewDataUrl && (
            <div className="rounded-xl border border-surface-subtle-light dark:border-surface-subtle-dark p-2 bg-white flex items-center justify-center max-h-32 overflow-hidden shadow-inner">
              <img
                src={previewDataUrl}
                alt="Handwriting Snapshot"
                className="max-h-28 object-contain"
              />
            </div>
          )}

          {/* Recognized Text Field */}
          <div>
            <label className="block text-xs font-medium text-ink-muted-light dark:text-ink-muted-dark mb-1.5">
              Recognized Text (Editable):
            </label>
            <textarea
              value={recognizedText}
              onChange={(e) => setRecognizedText(e.target.value)}
              placeholder={isLoading ? 'Transcribing...' : 'No text recognized.'}
              rows={5}
              className="w-full p-3.5 rounded-2xl bg-surface-subtle-light dark:bg-surface-subtle-dark border border-black/5 dark:border-white/5 outline-none focus:ring-2 focus:ring-violet-500 text-sm text-ink-light dark:text-ink-dark leading-relaxed font-sans resize-none"
            />
          </div>

          {/* Clear canvas after insert option */}
          <label className="flex items-center gap-2 cursor-pointer text-xs text-ink-light dark:text-ink-dark select-none">
            <input
              type="checkbox"
              checked={clearStrokesAfter}
              onChange={(e) => setClearStrokesAfter(e.target.checked)}
              className="rounded text-violet-600 focus:ring-violet-500"
            />
            <span>Clear recognized ink strokes from canvas after inserting</span>
          </label>

          {/* Optional Gemini AI Key section */}
          <div className="pt-2 border-t border-surface-subtle-light dark:border-surface-subtle-dark">
            <button
              type="button"
              onClick={() => setShowSettings(!showSettings)}
              className="text-xs text-violet-600 dark:text-violet-400 font-medium hover:underline flex items-center gap-1"
            >
              <Key className="w-3.5 h-3.5" />
              <span>{showSettings ? 'Hide AI Settings' : 'Enable Gemini AI for Advanced Handwriting (Optional)'}</span>
            </button>

            {showSettings && (
              <div className="mt-2.5 p-3 rounded-2xl bg-surface-subtle-light dark:bg-surface-subtle-dark space-y-2 text-xs">
                <p className="text-ink-muted-light dark:text-ink-muted-dark leading-relaxed">
                  By default, recognition runs completely offline via Tesseract.js. For complex handwriting, formulas, or markdown transcription, provide a Gemini API Key:
                </p>
                <input
                  type="password"
                  placeholder="Paste your Gemini API Key here"
                  value={geminiKey}
                  onChange={(e) => handleSaveGeminiKey(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-surface-light dark:bg-surface-dark border border-black/10 dark:border-white/10 outline-none focus:ring-1 focus:ring-violet-500 font-mono text-xs"
                />
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-surface-subtle-light dark:border-surface-subtle-dark bg-surface-subtle-light/40 dark:bg-surface-subtle-dark/40 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              disabled={!recognizedText}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark transition disabled:opacity-40"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              onClick={startRecognition}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-light dark:text-ink-dark transition disabled:opacity-40"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Retry</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium hover:bg-surface-subtle-light dark:hover:bg-surface-subtle-dark text-ink-muted-light dark:text-ink-muted-dark transition"
            >
              Cancel
            </button>
            <button
              onClick={handleInsert}
              disabled={!recognizedText || isLoading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white shadow-sm transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span>Insert into Note</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
