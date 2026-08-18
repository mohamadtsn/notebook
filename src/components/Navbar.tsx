import type { ReactNode } from 'react';
import { Menu, Moon, NotebookPen, Plus, Settings2, Sun } from 'lucide-react';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';

interface NavbarProps {
  onNewNote: () => void;
  onToggleSidebar: () => void;
  dark: boolean;
  onToggleDark: () => void;
  onOpenSettings: () => void;
  /** Slot for the sync status, kept out of the navbar's own concerns. */
  children?: ReactNode;
}

export function Navbar({
  onNewNote, onToggleSidebar, dark, onToggleDark, onOpenSettings, children,
}: NavbarProps) {
  return (
    // Floating, not docked: it hovers over the cards below so their text passes
    // under it. `pointer-events-none` on the bar itself would kill the buttons,
    // so it only spans the chrome height — nothing more is covered.
    <header
      className="glass-chrome absolute inset-x-(--shell-gap) top-0 z-30 flex h-(--chrome-h) items-center justify-between rounded-2xl px-2 sm:px-3"
      style={{ marginTop: 'calc(env(safe-area-inset-top) + var(--shell-gap))' }}
    >
      <div className="flex items-center gap-2">
        <IconButton label="نمایش فهرست یادداشت‌ها" onClick={onToggleSidebar} className="md:hidden">
          <Menu size={18} />
        </IconButton>
        {/* Mark, not a control: decorative, so it stays out of the a11y tree */}
        <span
          aria-hidden
          className="ms-1 flex size-8 items-center justify-center rounded-lg bg-accent text-on-accent shadow-e1"
        >
          <NotebookPen size={17} />
        </span>
        <h1 className="text-lg font-semibold tracking-[-0.01em] text-ink">دفترچه</h1>
      </div>

      <div className="flex items-center gap-1">
        {children}

        <IconButton label="تنظیمات" onClick={onOpenSettings}>
          <Settings2 size={17} />
        </IconButton>

        <IconButton label={dark ? 'حالت روشن' : 'حالت تاریک'} onClick={onToggleDark}>
          {dark ? <Sun size={17} /> : <Moon size={17} />}
        </IconButton>

        {/* The label is the only accessible name below `sm`, where it is visually
            hidden — without aria-label this is an unnamed icon button. DESIGN.md §8. */}
        <Button variant="primary" size="sm" onClick={onNewNote} aria-label="یادداشت جدید">
          <Plus size={16} />
          <span className="hidden sm:inline">یادداشت جدید</span>
        </Button>
      </div>
    </header>
  );
}
