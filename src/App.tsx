import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useNotes } from './hooks/useNotes';
import { useDarkMode } from './hooks/useDarkMode';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { EmptyState } from './components/EmptyState';
import { CommandPalette } from './components/CommandPalette';
import { InstallPrompt } from './components/InstallPrompt';
import { AuthDialog } from './components/AuthDialog';
import { SyncStatus } from './components/SyncStatus';
import { useAuth } from './hooks/useAuth';
import { useSync } from './hooks/useSync';
import { useSwUpdate } from './hooks/useSwUpdate';
import { useToast } from './components/ui/toast-context';
import { springDrag, easeDrawer } from './lib/motion';

type View = 'notes' | 'trash';

/** Dismiss threshold for the mobile sheet — either distance or a flick. */
const SHEET_DISMISS_PX = 60;
const SHEET_DISMISS_VELOCITY = 300;

export default function App() {
  const {
    notes, activeNote, activeNoteId, activeNotes, trashedNotes,
    createNote, updateNote, trashNote, restoreNote, permanentDelete,
    togglePin, setColor, selectNote, applySync,
  } = useNotes();

  const { dark, toggle: toggleDark } = useDarkMode();
  const { toast } = useToast();
  useSwUpdate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [view, setView] = useState<View>('notes');

  const { token, email, signIn, signOut } = useAuth();

  const handleUnauthorized = useCallback(() => {
    signOut();
    toast('نشست منقضی شد؛ دوباره وارد شوید');
  }, [signOut, toast]);

  const { state: syncState, sync } = useSync({
    token,
    notes,
    applySync,
    onUnauthorized: handleUnauthorized,
  });

  useKeyboardShortcuts({
    onNewNote: createNote,
    onOpenPalette: () => setPaletteOpen(true),
    onDeselect: () => selectNote(null),
  });

  const handleSelect = useCallback((id: string) => {
    selectNote(id);
    setSidebarOpen(false);
    // A note reached through search may live in the other view
    setView(notes.find(n => n.id === id)?.deletedAt ? 'trash' : 'notes');
  }, [selectNote, notes]);

  const handleViewChange = (v: View) => {
    setView(v);
    selectNote(null);
  };

  /** Delete is immediate and undoable — no confirm step. DESIGN.md §6. */
  const handleTrash = useCallback((id: string) => {
    trashNote(id);
    toast('یادداشت به سطل زباله رفت', {
      action: { label: 'واگرد', onClick: () => restoreNote(id) },
    });
  }, [trashNote, restoreNote, toast]);

  /** Permanent delete really is irreversible, so it keeps a confirmation. */
  const handlePermanentDelete = useCallback((id: string) => {
    if (confirm('این یادداشت برای همیشه حذف می‌شود. مطمئنید؟')) permanentDelete(id);
  }, [permanentDelete]);

  const isTrash = !!activeNote?.deletedAt;

  const sidebar = (
    <Sidebar
      notes={activeNotes}
      trashedNotes={trashedNotes}
      activeNoteId={activeNoteId}
      view={view}
      onViewChange={handleViewChange}
      onSelect={handleSelect}
      onOpenSearch={() => setPaletteOpen(true)}
    />
  );

  return (
    // The shell is a padded canvas holding floating cards; the navbar is *not*
    // in the flow, it hovers over them so their content scrolls underneath.
    // DESIGN.md §2 — that pass-under is the whole point of the glass.
    <div className="relative h-full overflow-hidden bg-canvas">
      {/* Cards clear the navbar instead of sliding under it: text disappearing
          behind the chrome reads as a glitch, not as depth. */}
      <div
        className="flex h-full gap-(--shell-gap) p-(--shell-gap)"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + var(--shell-gap) + var(--chrome-inset))' }}
      >
        {/* Desktop: static column */}
        <div className="hidden shrink-0 md:flex">{sidebar}</div>

        <main className="min-w-0 flex-1 overflow-hidden">
          {activeNote ? (
            <Editor
              key={activeNote.id}
              note={activeNote}
              isTrash={isTrash}
              onUpdate={updateNote}
              onTrash={handleTrash}
              onRestore={restoreNote}
              onPermanentDelete={handlePermanentDelete}
              onTogglePin={togglePin}
              onSetColor={setColor}
            />
          ) : (
            <EmptyState onNewNote={view === 'notes' ? createNote : undefined} />
          )}
        </main>
      </div>

      {/* Mobile: drag-dismissable sheet, above the floating navbar */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: easeDrawer }}
              onClick={() => setSidebarOpen(false)}
              className="scrim fixed inset-0 z-40 md:hidden"
            />
            <motion.div
              // ponytail: the document is always dir="rtl", so the sheet sits on the
              // right and "out" is +x. Revisit if an LTR document mode is ever added.
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={springDrag}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={{ left: 0, right: 1 }}
              dragMomentum={false}
              onDragEnd={(_, info) => {
                if (info.offset.x > SHEET_DISMISS_PX || info.velocity.x > SHEET_DISMISS_VELOCITY) {
                  setSidebarOpen(false);
                }
              }}
              className="fixed bottom-(--shell-gap) start-(--shell-gap) z-50 touch-pan-y md:hidden"
              style={{ top: 'calc(env(safe-area-inset-top) + var(--shell-gap) + var(--chrome-inset))' }}
            >
              {sidebar}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <Navbar
        onNewNote={createNote}
        onToggleSidebar={() => setSidebarOpen(o => !o)}
        dark={dark}
        onToggleDark={toggleDark}
      >
        <SyncStatus
          state={syncState}
          email={email}
          pending={notes.filter(n => n.dirty).length}
          onSync={() => void sync()}
          onSignIn={() => setAuthOpen(true)}
          onSignOut={signOut}
        />
      </Navbar>

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          notes={notes.filter(n => !n.deletedAt)}
          dark={dark}
          onSelectNote={handleSelect}
          onNewNote={createNote}
          onToggleDark={toggleDark}
          onOpenTrash={() => handleViewChange('trash')}
        />
      )}

      <AnimatePresence>
        {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} onSubmit={signIn} />}
      </AnimatePresence>

      <InstallPrompt />
    </div>
  );
}
