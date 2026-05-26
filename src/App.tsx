import { useState, useRef } from 'react';
import { useNotes } from './hooks/useNotes';
import { useDarkMode } from './hooks/useDarkMode';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { EmptyState } from './components/EmptyState';

type View = 'notes' | 'trash';

export default function App() {
  const {
    activeNote, activeNoteId, activeNotes, trashedNotes,
    createNote, updateNote, trashNote, restoreNote, permanentDelete,
    togglePin, setColor, selectNote,
  } = useNotes();

  const { dark, toggle: toggleDark } = useDarkMode();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<View>('notes');
  const searchRef = useRef<HTMLInputElement>(null);

  useKeyboardShortcuts({
    onNewNote: createNote,
    onDeselect: () => selectNote(null),
    searchRef,
  });

  const handleSelect = (id: string) => {
    selectNote(id);
    setSidebarOpen(false);
  };

  const handleViewChange = (v: View) => {
    setView(v);
    selectNote(null);
  };

  const isTrash = !!activeNote?.deletedAt;

  return (
    <div className="h-screen flex flex-col bg-paper overflow-hidden">
      <Navbar
        onNewNote={createNote}
        onToggleSidebar={() => setSidebarOpen(o => !o)}
        dark={dark}
        onToggleDark={toggleDark}
      />

      <div className="flex flex-1 overflow-hidden relative">
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-10 bg-black/30 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <div
          className={`
            absolute inset-y-0 left-0 z-20
            md:static md:z-auto md:flex md:shrink-0
            transition-transform duration-200
            ${sidebarOpen ? 'flex' : 'hidden md:flex'}
          `}
        >
          <Sidebar
            ref={searchRef}
            notes={activeNotes}
            trashedNotes={trashedNotes}
            activeNoteId={activeNoteId}
            view={view}
            onViewChange={handleViewChange}
            onSelect={handleSelect}
          />
        </div>

        <main className="flex-1 overflow-hidden">
          {activeNote ? (
            <Editor
              key={activeNote.id}
              note={activeNote}
              isTrash={isTrash}
              onUpdate={updateNote}
              onTrash={trashNote}
              onRestore={restoreNote}
              onPermanentDelete={permanentDelete}
              onTogglePin={togglePin}
              onSetColor={setColor}
            />
          ) : (
            <EmptyState onNewNote={view === 'notes' ? createNote : undefined} />
          )}
        </main>
      </div>
    </div>
  );
}