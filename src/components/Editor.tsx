import { useState, useEffect, useCallback } from 'react';
import { Trash2, Pin, Download, Eye, EyeOff, Undo2 } from 'lucide-react';
import type { Note, NoteColor } from '../types/note';
import { NOTE_COLOR_HEX } from '../types/note';
import { useDebounce } from '../hooks/useDebounce';
import { useTextDirection } from '../hooks/useTextDirection';
import { renderMarkdown } from '../utils/markdown';

interface EditorProps {
  note: Note;
  isTrash?: boolean;
  onUpdate: (id: string, patch: Partial<Pick<Note, 'title' | 'body' | 'color' | 'pinned'>>) => void;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onPermanentDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onSetColor: (id: string, color: NoteColor | null) => void;
}

const COLORS: (NoteColor | null)[] = ['yellow', 'blue', 'green', 'pink', 'purple', null];

function formatTime(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'همین الان';
  if (minutes < 60) return `${minutes} دقیقه پیش`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours} ساعت پیش`;
  const days = Math.floor(diff / 86400000);
  return `${days} روز پیش`;
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function exportNote(note: Note, format: 'txt' | 'md') {
  const content = format === 'md'
    ? `# ${note.title}\n\n${note.body}`
    : `${note.title}\n${'='.repeat(note.title.length || 1)}\n\n${note.body}`;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${note.title || 'یادداشت'}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Editor({
  note,
  isTrash = false,
  onUpdate,
  onTrash,
  onRestore,
  onPermanentDelete,
  onTogglePin,
  onSetColor,
}: EditorProps) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [showTrashConfirm, setShowTrashConfirm] = useState(false);
  const [showPermConfirm, setShowPermConfirm] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [preview, setPreview] = useState(false);

  const debouncedTitle = useDebounce(title, 500);
  const debouncedBody  = useDebounce(body, 500);

  const titleDir = useTextDirection(title);
  const bodyDir  = useTextDirection(body);
  const bodyFont = bodyDir === 'rtl'
    ? '"Vazirmatn", "Tahoma", sans-serif'
    : '"Lora", "Georgia", serif';

  useEffect(() => {
    if (debouncedTitle === note.title && debouncedBody === note.body) return;
    setSaveStatus('saving');
    onUpdate(note.id, { title: debouncedTitle, body: debouncedBody });
    const t = setTimeout(() => setSaveStatus('saved'), 300);
    return () => clearTimeout(t);
  }, [debouncedTitle, debouncedBody]);

  const handleTrash = useCallback(() => {
    if (showTrashConfirm) {
      onTrash(note.id);
    } else {
      setShowTrashConfirm(true);
      setTimeout(() => setShowTrashConfirm(false), 3000);
    }
  }, [showTrashConfirm, note.id, onTrash]);

  const handlePermDelete = useCallback(() => {
    if (showPermConfirm) {
      onPermanentDelete(note.id);
    } else {
      setShowPermConfirm(true);
      setTimeout(() => setShowPermConfirm(false), 3000);
    }
  }, [showPermConfirm, note.id, onPermanentDelete]);

  return (
    <div className="h-full flex flex-col" onClick={() => { setShowColorPicker(false); setShowExportMenu(false); }}>
      {/* Trash banner */}
      {isTrash && (
        <div className="bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800 px-6 py-2 flex items-center justify-between shrink-0">
          <span className="text-xs text-red-600 dark:text-red-400">این یادداشت در سطل زباله است</span>
          <button
            onClick={() => onRestore(note.id)}
            className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1 hover:underline"
          >
            <Undo2 size={12} />
            بازگرداندن
          </button>
        </div>
      )}

      {/* Title */}
      <div className="px-8 pt-6 pb-2">
        <input
          type="text"
          value={title}
          onChange={e => { setTitle(e.target.value); setSaveStatus('saving'); }}
          placeholder="عنوان"
          dir={titleDir}
          disabled={isTrash}
          className="w-full text-2xl font-semibold text-ink bg-transparent border-none outline-none placeholder:text-muted disabled:opacity-60"
          style={{ fontFamily: "'Inter', sans-serif" }}
        />
      </div>

      {/* Body / Preview */}
      <div className="flex-1 px-8 pb-4 overflow-auto">
        {preview ? (
          <div
            className="markdown-preview h-full"
            style={{ fontFamily: bodyFont }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
          />
        ) : (
          <textarea
            value={body}
            onChange={e => { setBody(e.target.value); setSaveStatus('saving'); }}
            placeholder="شروع کنید به نوشتن..."
            dir={bodyDir}
            disabled={isTrash}
            className="w-full h-full resize-none bg-transparent border-none outline-none text-base text-ink placeholder:text-muted leading-relaxed disabled:opacity-60"
            style={{ fontFamily: bodyFont }}
          />
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-2.5 border-t border-border flex items-center justify-between shrink-0 gap-2">
        <span className="text-xs text-muted whitespace-nowrap">
          {wordCount(body)} کلمه · {formatTime(note.updatedAt)}
        </span>

        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          {/* Save status */}
          {saveStatus === 'saving' && <span className="text-xs text-muted ml-1">ذخیره...</span>}
          {saveStatus === 'saved'  && <span className="text-xs text-green-600 ml-1">ذخیره شد</span>}

          {/* Markdown preview toggle */}
          <button
            onClick={() => setPreview(p => !p)}
            title={preview ? 'بازگشت به ویرایش' : 'پیش‌نمایش Markdown'}
            className={`p-1.5 rounded-md transition-colors ${preview ? 'text-accent' : 'text-muted hover:text-ink'}`}
          >
            {preview ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>

          {/* Pin */}
          {!isTrash && (
            <button
              onClick={() => onTogglePin(note.id)}
              title={note.pinned ? 'برداشتن سنجاق' : 'سنجاق کردن'}
              className={`p-1.5 rounded-md transition-colors ${note.pinned ? 'text-accent' : 'text-muted hover:text-ink'}`}
            >
              <Pin size={15} />
            </button>
          )}

          {/* Color picker */}
          {!isTrash && (
            <div className="relative">
              <button
                onClick={() => { setShowColorPicker(p => !p); setShowExportMenu(false); }}
                title="رنگ یادداشت"
                className="p-1.5 rounded-md text-muted hover:text-ink transition-colors"
              >
                <span
                  className="w-3.5 h-3.5 rounded-full border border-border block"
                  style={{ backgroundColor: note.color ? NOTE_COLOR_HEX[note.color] : 'transparent' }}
                />
              </button>
              {showColorPicker && (
                <div className="absolute bottom-full mb-2 right-0 bg-paper border border-border rounded-lg p-2 flex gap-1.5 shadow-lg z-10">
                  {COLORS.map(c => (
                    <button
                      key={c ?? 'none'}
                      onClick={() => { onSetColor(note.id, c); setShowColorPicker(false); }}
                      className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
                      style={{
                        backgroundColor: c ? NOTE_COLOR_HEX[c] : 'transparent',
                        borderColor: note.color === c ? 'var(--accent)' : 'var(--border)',
                      }}
                      title={c ?? 'بدون رنگ'}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Export */}
          <div className="relative">
            <button
              onClick={() => { setShowExportMenu(p => !p); setShowColorPicker(false); }}
              title="دانلود یادداشت"
              className="p-1.5 rounded-md text-muted hover:text-ink transition-colors"
            >
              <Download size={15} />
            </button>
            {showExportMenu && (
              <div className="absolute bottom-full mb-2 right-0 bg-paper border border-border rounded-lg overflow-hidden shadow-lg z-10 min-w-[100px]">
                <button
                  onClick={() => { exportNote(note, 'md'); setShowExportMenu(false); }}
                  className="block w-full text-right px-3 py-2 text-xs text-ink hover:bg-border/40 transition-colors"
                >
                  دانلود .md
                </button>
                <button
                  onClick={() => { exportNote(note, 'txt'); setShowExportMenu(false); }}
                  className="block w-full text-right px-3 py-2 text-xs text-ink hover:bg-border/40 transition-colors"
                >
                  دانلود .txt
                </button>
              </div>
            )}
          </div>

          {/* Delete / Restore / Permanent delete */}
          {isTrash ? (
            <button
              onClick={handlePermDelete}
              className={`text-xs flex items-center gap-1 transition-colors p-1.5 rounded-md ${
                showPermConfirm ? 'text-red-500' : 'text-muted hover:text-red-400'
              }`}
            >
              <Trash2 size={14} />
              {showPermConfirm ? 'مطمئنی؟' : 'حذف کامل'}
            </button>
          ) : (
            <button
              onClick={handleTrash}
              className={`text-xs flex items-center gap-1 transition-colors p-1.5 rounded-md ${
                showTrashConfirm ? 'text-red-500' : 'text-muted hover:text-red-400'
              }`}
            >
              <Trash2 size={14} />
              {showTrashConfirm ? 'مطمئنی؟' : 'حذف'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}