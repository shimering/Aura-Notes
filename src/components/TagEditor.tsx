import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Tag, X, Plus } from 'lucide-react';

interface TagEditorProps {
  tags: string[];
  allTags: string[];
  onChange: (tags: string[]) => void;
  onClose: () => void;
}

const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 24;

export const TagEditor: React.FC<TagEditorProps> = ({ tags, allTags, onChange, onClose }) => {
  const [input, setInput] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const normalizedTags = useMemo(
    () => new Set(tags.map((t) => t.toLowerCase())),
    [tags]
  );

  const suggestions = useMemo(
    () =>
      allTags.filter(
        (t) => !normalizedTags.has(t.toLowerCase()) && t.toLowerCase().includes(input.trim().toLowerCase())
      ).slice(0, 6),
    [allTags, normalizedTags, input]
  );

  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/^#/, '').slice(0, MAX_TAG_LENGTH);
    if (!tag) return;
    if (tags.length >= MAX_TAGS) return;
    if (normalizedTags.has(tag.toLowerCase())) {
      setInput('');
      return;
    }
    onChange([...tags, tag]);
    setInput('');
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  return (
    <div
      ref={panelRef}
      className="absolute top-full left-0 mt-2 z-50 w-72 p-3 rounded-2xl bg-surface-light dark:bg-surface-dark border border-surface-subtle-light dark:border-surface-subtle-dark shadow-floating animate-in fade-in slide-in-from-top-1"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-ink-light dark:text-ink-dark flex items-center gap-1.5">
          <Tag className="w-3.5 h-3.5 text-violet-500" />
          Note Tags
        </span>
        <span className="text-[10px] text-ink-muted-light dark:text-ink-muted-dark">
          {tags.length}/{MAX_TAGS}
        </span>
      </div>

      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-[11px] font-medium"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                title={`Remove tag ${tag}`}
                className="hover:text-violet-900 dark:hover:text-violet-100"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-ink-muted-light dark:text-ink-muted-dark mb-2.5">
          No tags yet. Tags make notes easy to filter in the sidebar.
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          addTag(input);
        }}
        className="flex items-center gap-1.5"
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Add a tag..."
          maxLength={MAX_TAG_LENGTH}
          className="flex-1 px-2.5 py-1.5 rounded-lg bg-surface-subtle-light dark:bg-surface-subtle-dark border-none outline-none focus:ring-2 focus:ring-violet-500 text-xs text-ink-light dark:text-ink-dark"
        />
        <button
          type="submit"
          disabled={!input.trim() || tags.length >= MAX_TAGS}
          title="Add tag"
          className="p-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </form>

      {suggestions.length > 0 && (
        <div className="mt-2 pt-2 border-t border-surface-subtle-light dark:border-surface-subtle-dark">
          <p className="text-[10px] uppercase tracking-wider text-ink-muted-light dark:text-ink-muted-dark mb-1.5">
            Existing tags
          </p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => addTag(tag)}
                className="px-2 py-0.5 rounded-md bg-surface-subtle-light dark:bg-surface-subtle-dark text-[11px] text-ink-light dark:text-ink-dark hover:bg-violet-100 dark:hover:bg-violet-900/40 transition"
              >
                + {tag}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
