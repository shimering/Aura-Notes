import React from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message || 'Unknown error' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Aura Notes crashed:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="h-full w-full flex items-center justify-center p-6 bg-canvas-light dark:bg-canvas-dark text-ink-light dark:text-ink-dark">
        <div className="max-w-md w-full p-6 rounded-3xl bg-surface-light dark:bg-surface-dark border border-surface-subtle-light dark:border-surface-subtle-dark shadow-floating text-center">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-rose-100 dark:bg-rose-950/50 flex items-center justify-center text-rose-600 dark:text-rose-400">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h1 className="mt-4 text-lg font-bold">Something went wrong</h1>
          <p className="mt-1.5 text-sm text-ink-muted-light dark:text-ink-muted-dark break-words">
            {this.state.message}
          </p>
          <p className="mt-3 text-xs text-ink-muted-light dark:text-ink-muted-dark">
            Your notes are saved locally. Reloading should bring everything back.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold shadow-md transition active:scale-95"
          >
            <RotateCw className="w-4 h-4" />
            Reload App
          </button>
        </div>
      </div>
    );
  }
}
