import { Plus, Menu, Sun, Moon } from 'lucide-react';

interface NavbarProps {
  onNewNote: () => void;
  onToggleSidebar: () => void;
  dark: boolean;
  onToggleDark: () => void;
}

export function Navbar({ onNewNote, onToggleSidebar, dark, onToggleDark }: NavbarProps) {
  return (
    <header className="h-14 border-b border-border bg-paper flex items-center justify-between px-4 shrink-0 z-30 relative">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="md:hidden p-1.5 rounded-md text-muted hover:bg-border transition-colors"
          aria-label="Toggle sidebar"
        >
          <Menu size={18} />
        </button>
        <h1
          className="text-lg font-semibold text-ink tracking-tight"
          style={{ fontFamily: "'Inter', sans-serif" }}
        >
          Notebook
        </h1>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onToggleDark}
          title={dark ? 'حالت روشن' : 'حالت تاریک'}
          className="p-1.5 rounded-md text-muted hover:bg-border transition-colors"
        >
          {dark ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <button
          onClick={onNewNote}
          className="flex items-center cursor-pointer gap-1.5 bg-accent text-white text-sm font-medium px-3 py-1.5 rounded-md hover:opacity-90 transition-opacity"
        >
          <Plus size={16} />
          <span>یادداشت جدید</span>
        </button>
      </div>
    </header>
  );
}