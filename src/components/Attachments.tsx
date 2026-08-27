import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, Paperclip, Trash2, X } from 'lucide-react';
import type { Attachment, WireAttachment } from '../types/attachment';
import { formatBytes } from '../types/attachment';
import {
  ATTACHMENT_MESSAGES, AttachmentError, download, precheck, remove, upload,
} from '../utils/attachments';
import { easeOut, springUI } from '../lib/motion';
import { IconButton } from './ui/IconButton';
import { useToast } from './ui/toast-context';

interface AttachmentsProps {
  noteId: string;
  token: string;
  attachments: Attachment[];
  onAdded: (wire: WireAttachment) => void;
  onRemoved: (id: string) => void;
  /** Trash hides the controls: a note on its way out is not a place to add files. */
  readOnly: boolean;
}

/**
 * The file strip under the editor body.
 *
 * **Attachments live outside markdown, deliberately.** `utils/markdown.ts` disables
 * images on purpose — an `![]()` is an `onerror` surface and a third-party fetch from a
 * previewed note — and rendering an attachment through that pipeline would reopen
 * exactly what it was closed for. A list needs none of it.
 *
 * Absent without a pro token: the parent does not render this at all. Not disabled,
 * absent — with no upgraded account the app is exactly the app it was before
 * attachments existed (PRODUCT.md principle 1).
 */
export function Attachments({
  noteId, token, attachments, onAdded, onRemoved, readOnly,
}: AttachmentsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dropping, setDropping] = useState(false);
  const { toast } = useToast();

  const send = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      // Refused here rather than after the upload, so a 10 MB file does not travel
      // before being told no. The server checks all of it again.
      const bad = precheck(file);
      if (bad) {
        toast(`«${file.name}»: ${ATTACHMENT_MESSAGES[bad]}`);
        continue;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setProgress(0);
      try {
        onAdded(await upload(token, noteId, file, {
          signal: controller.signal,
          onProgress: setProgress,
        }));
      } catch (err) {
        if (!controller.signal.aborted) {
          toast(err instanceof AttachmentError ? err.message : ATTACHMENT_MESSAGES.failed);
        }
      } finally {
        abortRef.current = null;
        setProgress(null);
      }
    }
  };

  const del = async (a: Attachment) => {
    try {
      await remove(token, a.id);
      onRemoved(a.id);
      // No undo: the bytes are unlinked server-side and cannot be handed back. This is
      // the one attachment action that asks nothing and cannot be reversed, so it says so.
      toast(`«${a.name}» حذف شد`);
    } catch {
      toast('حذف فایل انجام نشد.');
    }
  };

  const get = async (a: Attachment) => {
    try {
      await download(token, a.id, a.name);
    } catch {
      toast('دریافت فایل انجام نشد.');
    }
  };

  const empty = attachments.length === 0;
  if (readOnly && empty) return null;

  return (
    <div
      onDragOver={e => { if (!readOnly) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={() => setDropping(false)}
      onDrop={e => {
        if (readOnly) return;
        e.preventDefault();
        setDropping(false);
        if (e.dataTransfer.files.length) void send(e.dataTransfer.files);
      }}
      className={[
        'mt-2 rounded-xl border border-dashed p-2 transition-colors duration-(--d-fast)',
        dropping ? 'border-accent bg-accent-soft' : 'border-separator',
      ].join(' ')}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">پیوست‌ها</span>
        {!readOnly && (
          <>
            <IconButton label="افزودن فایل" onClick={() => inputRef.current?.click()}>
              <Paperclip size={16} />
            </IconButton>
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              onChange={e => {
                if (e.target.files?.length) void send(e.target.files);
                // Reset so picking the same file twice in a row still fires `change`.
                e.target.value = '';
              }}
            />
          </>
        )}
      </div>

      {/* Progress uses the shared motion tokens — no new spinner component. */}
      <AnimatePresence>
        {progress !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: easeOut }}
            className="mt-2 flex items-center gap-2"
          >
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-fill">
              <motion.div
                className="h-full rounded-full bg-accent"
                // Width, not a transform: the bar's inline start is its origin in both
                // directions, so this needs no RTL variant.
                animate={{ width: `${Math.round(progress * 100)}%` }}
                transition={springUI}
              />
            </div>
            <IconButton label="لغو بارگذاری" onClick={() => abortRef.current?.abort()}>
              <X size={14} />
            </IconButton>
          </motion.div>
        )}
      </AnimatePresence>

      <ul className="mt-1">
        {attachments.map(a => (
          <li key={a.id} className="flex min-h-11 items-center gap-2 py-1">
            {/* `dir="ltr"` only when the name has no strong RTL character would need the
                direction util; a filename is a title, so it inherits the note's own
                direction and truncates rather than wraps. */}
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{a.name}</span>
            <span className="shrink-0 text-xs text-muted">{formatBytes(a.size)}</span>
            <IconButton label={`دانلود ${a.name}`} onClick={() => void get(a)}>
              <Download size={16} />
            </IconButton>
            {!readOnly && (
              <IconButton label={`حذف ${a.name}`} tone="danger" onClick={() => void del(a)}>
                <Trash2 size={16} />
              </IconButton>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
