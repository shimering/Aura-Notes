import React, { useState, useEffect } from 'react';

export default function App() {
  const [isDark, setIsDark] = useState(() => {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  return (
    <div className="h-full w-full flex flex-col bg-canvas-light dark:bg-canvas-dark text-ink-light dark:text-ink-dark transition-colors duration-200">
      <div className="flex items-center justify-between p-4 border-b border-surface-subtle-light dark:border-surface-subtle-dark">
        <h1 className="font-semibold text-lg tracking-tight">Aura Notes</h1>
        <button
          onClick={() => setIsDark(!isDark)}
          className="px-3 py-1.5 rounded-lg text-sm bg-surface-subtle-light dark:bg-surface-subtle-dark hover:opacity-80 transition"
        >
          {isDark ? 'Light Mode' : 'Dark Mode'}
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center p-6 text-ink-muted-light dark:text-ink-muted-dark">
        Initializing Aura Notes Studio...
      </div>
    </div>
  );
}
