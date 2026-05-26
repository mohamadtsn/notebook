import { NotebookPen } from 'lucide-react';

interface EmptyStateProps {
  onNewNote?: () => void;
}

export function EmptyState({ onNewNote }: EmptyStateProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-8">
      <NotebookPen size={48} className="text-border mb-4" />
      <h2
        className="text-lg font-medium text-ink mb-1"
        style={{ fontFamily: "'Vazirmatn', sans-serif" }}
      >
        یادداشتی انتخاب نشده
      </h2>
      <p
        className="text-sm text-muted mb-6"
        style={{ fontFamily: "'Vazirmatn', sans-serif" }}
      >
        یک یادداشت از لیست انتخاب کنید
        {onNewNote ? ' یا یادداشت جدیدی بسازید' : ' یا یادداشتی را بازگردانید'}
      </p>
      {onNewNote && (
        <button
          onClick={onNewNote}
          className="bg-accent text-white cursor-pointer text-sm font-medium px-4 py-2 rounded-md hover:opacity-90 transition-opacity"
          style={{ fontFamily: "'Vazirmatn', sans-serif" }}
        >
          یادداشت جدید
        </button>
      )}
    </div>
  );
}