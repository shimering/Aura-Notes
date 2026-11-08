import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Stroke, StrokePoint, PenTool } from '../types/note';
import { renderStroke } from '../utils/inkSmoothing';
import { PenToolbar } from './PenToolbar';

export interface InkCanvasRef {
  getCanvasElement: () => HTMLCanvasElement | null;
  exportImageData: () => ImageData | null;
  exportDataUrl: () => string;
}

interface InkCanvasProps {
  strokes: Stroke[];
  onChangeStrokes: (strokes: Stroke[]) => void;
  onScribbleToText: () => void;
}

export const InkCanvas = forwardRef<InkCanvasRef, InkCanvasProps>(({
  strokes,
  onChangeStrokes,
  onScribbleToText
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Inking state
  const [activeTool, setActiveTool] = useState<PenTool>('fountain');
  const [penColor, setPenColor] = useState<string>('#1e293b');
  const [penWidth, setPenWidth] = useState<number>(4);

  // History for Undo/Redo
  const [historyIndex, setHistoryIndex] = useState<number>(strokes.length);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const isStylusActiveRef = useRef<boolean>(false);

  // Expose methods for OCR engine
  useImperativeHandle(ref, () => ({
    getCanvasElement: () => canvasRef.current,
    exportImageData: () => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    },
    exportDataUrl: () => {
      const canvas = canvasRef.current;
      return canvas ? canvas.toDataURL('image/png') : '';
    }
  }));

  // Synchronize internal history pointer when external note changes
  useEffect(() => {
    setHistoryIndex(strokes.length);
  }, [strokes]);

  // Redraw all strokes on canvas
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Render strokes up to history index
    const visibleStrokes = strokes.slice(0, historyIndex);
    for (const stroke of visibleStrokes) {
      renderStroke(ctx, stroke, dpr);
    }

    // Render current active stroke live
    if (currentStrokeRef.current) {
      renderStroke(ctx, currentStrokeRef.current, dpr);
    }
  }, [strokes, historyIndex]);

  // Handle canvas resize and high-DPI scaling
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    redraw();
  }, [redraw]);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [resizeCanvas]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  // Extract pointer coordinates relative to canvas
  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>): StrokePoint => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, pressure: 0.5, time: Date.now() };

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Stylus pressure detection (Apple Pencil / S Pen provide dynamic pressure)
    // If not supported by device, fallback smoothly
    let pressure = e.pressure;
    if (pressure === 0 && e.pointerType === 'pen') {
      pressure = 0.5;
    } else if (pressure === 0) {
      pressure = 0.5;
    }

    return {
      x,
      y,
      pressure,
      time: Date.now()
    };
  };

  // Pointer Down (stylus touches screen)
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Palm Rejection: If stylus is active or pointerType is touch while drawing, reject palm touches
    if (e.pointerType === 'pen') {
      isStylusActiveRef.current = true;
    } else if (isStylusActiveRef.current && e.pointerType === 'touch') {
      return; // Ignore accidental palm touch
    }

    e.currentTarget.setPointerCapture(e.pointerId);

    // Detect S Pen barrel button or eraser tip
    // e.buttons === 32 indicates barrel button pressed on Galaxy S Pen
    const isHardwareEraser = e.buttons === 32 || e.button === 5 || activeTool === 'eraser';
    const effectiveTool: PenTool = isHardwareEraser ? 'eraser' : activeTool;

    const startPoint = getCanvasPoint(e);
    const newStroke: Stroke = {
      id: `stroke-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      points: [startPoint],
      color: effectiveTool === 'eraser' ? '#ffffff' : penColor,
      width: penWidth,
      tool: effectiveTool,
      opacity: effectiveTool === 'highlighter' ? 0.4 : 1.0
    };

    currentStrokeRef.current = newStroke;
    redraw();
  };

  // Pointer Move (coalesced 120Hz events loop)
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!currentStrokeRef.current) return;

    // Palm rejection check
    if (isStylusActiveRef.current && e.pointerType === 'touch') {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    // 120Hz Coalesced Events Loop for iPad ProMotion & Galaxy Tab 120Hz AMOLED
    const nativeEvent = e.nativeEvent as PointerEvent;
    const coalescedEvents = (nativeEvent.getCoalescedEvents ? nativeEvent.getCoalescedEvents() : [nativeEvent]);

    for (const ce of coalescedEvents) {
      let pressure = ce.pressure;
      if (pressure === 0 && ce.pointerType === 'pen') {
        pressure = 0.5;
      } else if (pressure === 0) {
        pressure = 0.5;
      }

      currentStrokeRef.current.points.push({
        x: ce.clientX - rect.left,
        y: ce.clientY - rect.top,
        pressure,
        time: Date.now()
      });
    }

    redraw();
  };

  // Pointer Up (stylus lifted from screen)
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    if (e.pointerType === 'pen') {
      isStylusActiveRef.current = false;
    }

    if (currentStrokeRef.current) {
      const finishedStroke = currentStrokeRef.current;
      currentStrokeRef.current = null;

      // Truncate any redo branches and append new stroke
      const updatedStrokes = [...strokes.slice(0, historyIndex), finishedStroke];
      setHistoryIndex(updatedStrokes.length);
      onChangeStrokes(updatedStrokes);
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    isStylusActiveRef.current = false;
    currentStrokeRef.current = null;
    redraw();
  };

  // Undo / Redo / Clear handlers
  const handleUndo = () => {
    if (historyIndex > 0) {
      const nextIndex = historyIndex - 1;
      setHistoryIndex(nextIndex);
      onChangeStrokes(strokes.slice(0, nextIndex));
    }
  };

  const handleRedo = () => {
    if (historyIndex < strokes.length) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      onChangeStrokes(strokes.slice(0, nextIndex));
    }
  };

  const handleClear = () => {
    if (confirm('Clear all drawings and handwriting from canvas?')) {
      setHistoryIndex(0);
      onChangeStrokes([]);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-canvas-light dark:bg-canvas-dark relative select-none">
      {/* Top Floating Pen Toolbar */}
      <div className="p-3 flex items-center justify-center sticky top-0 z-10 pointer-events-none">
        <div className="pointer-events-auto">
          <PenToolbar
            activeTool={activeTool}
            onSelectTool={setActiveTool}
            color={penColor}
            onChangeColor={setPenColor}
            width={penWidth}
            onChangeWidth={setPenWidth}
            canUndo={historyIndex > 0}
            canRedo={historyIndex < strokes.length}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onClear={handleClear}
            onScribbleToText={onScribbleToText}
            hasStrokes={strokes.length > 0}
          />
        </div>
      </div>

      {/* Drawing Canvas Container */}
      <div 
        ref={containerRef} 
        className="flex-1 w-full h-full relative cursor-crosshair overflow-hidden touch-none"
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={handlePointerCancel}
          className="ink-canvas absolute inset-0 block w-full h-full"
        />

        {strokes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-ink-muted-light/60 dark:text-ink-muted-dark/60 text-sm">
            <p className="font-medium">Write with S Pen or Apple Pencil</p>
            <p className="text-xs mt-1">Pressure sensitive • Palm rejection • Scribble to text</p>
          </div>
        )}
      </div>
    </div>
  );
});

InkCanvas.displayName = 'InkCanvas';
