import { useCallback, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useNotes } from './hooks/useNotes';
import { useGroups } from './hooks/useGroups';
import { useSettings } from './hooks/useSettings';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { EmptyState } from './components/EmptyState';
import { CommandPalette } from './components/CommandPalette';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { InstallPrompt } from './components/InstallPrompt';
import { AuthDialog } from './components/AuthDialog';
import { Settings } from './components/Settings';
import { SyncStatus } from './components/SyncStatus';
import { useAuth } from './hooks/useAuth';
import { useAttachments } from './hooks/useAttachments';
import { useSync } from './hooks/useSync';
import { useSwUpdate } from './hooks/useSwUpdate';
import { useToast } from './components/ui/toast-context';
import { springDrag, easeDrawer } from './lib/motion';
import type { GroupFilter } from './types/group';

type View = 'notes' | 'trash';

/** Dismiss threshold for the mobile sheet — either distance or a flick. */
const SHEET_DISMISS_PX = 60;
const SHEET_DISMISS_VELOCITY = 300;

export default function App() {
  const {
    notes, activeNote, activeNoteId, activeNotes, trashedNotes,
    createNote, updateNote, trashNote, restoreNote, permanentDelete,
    togglePin, setColor, setGroup, clearGroup, restoreGroups, selectNote, applySync,
  } = useNotes();

  const {
    groups, activeGroups, createGroup, renameGroup, deleteGroup, restoreGroup, applyGroupSync,
  } = useGroups();

  const [selectedGroup, setSelectedGroup] = useState<GroupFilter>('all');

  /**
   * «همه» is a filter, not a destination: creating a note there means «بدون گروه».
   * Wrapped rather than passed directly, because `createNote` now takes an argument
   * and an unwrapped `onClick` would hand it a MouseEvent as the group id.
   */
  const newNote = useCallback(
    () => createNote(selectedGroup === 'all' ? null : selectedGroup),
    [createNote, selectedGroup],
  );

  const {
    settings, update: updateSettings, updateAi, applyRemote, resolvedDark,
  } = useSettings();

  /**
   * The navbar/palette control is a toggle, so it only ever cycles the two explicit
   * values — a toggle must not be able to land the user on `system` by accident.
   */
  const toggleDark = useCallback(
    () => updateSettings({ theme: resolvedDark ? 'light' : 'dark' }),
    [updateSettings, resolvedDark],
  );

  const { toast } = useToast();
  useSwUpdate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Keyboard paths open the panel instantly; a pointer click gets the enter. DESIGN.md §5.
  const [settingsInstant, setSettingsInstant] = useState(false);
  const [shortcuts, setShortcuts] = useState<{ instant: boolean } | null>(null);
  const [view, setView] = useState<View>('notes');

  const { token, email, signIn, signOut, tier, isAdmin } = useAuth();
  const {
    forNote: attachmentsForNote, add: addAttachment, drop: dropAttachment,
    applyAttachmentSync, clearAttachments,
  } = useAttachments();

  const handleUnauthorized = useCallback(() => {
    signOut();
    // The attachment mirror is derived data about files behind an account, so it goes
    // with the token. Every local NOTE stays — that promise is unchanged.
    clearAttachments();
    toast('نشست منقضی شد؛ دوباره وارد شوید');
  }, [signOut, clearAttachments, toast]);

  const { state: syncState, settingsState, sync } = useSync({
    token,
    notes,
    intervalMs: settings.syncIntervalMs,
    settings,
    applyRemoteSettings: applyRemote,
    groups,
    applyGroupSync,
    applySync,
    applyAttachmentSync,
    onUnauthorized: handleUnauthorized,
  });

  useKeyboardShortcuts({
    onNewNote: newNote,
    onOpenPalette: () => setPaletteOpen(true),
    onOpenSettings: () => { setSettingsInstant(true); setSettingsOpen(true); },
    onOpenShortcuts: () => setShortcuts({ instant: true }),
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

  /**
   * Deleting a group never deletes its notes — they fall back to «بدون گروه».
   * The previous assignments are captured BEFORE the write, because after it they
   * are gone and the undo would have nothing to restore. DESIGN.md §6: undo, not confirm.
   */
  const handleDeleteGroup = useCallback((id: string) => {
    const previous = clearGroup(id);
    deleteGroup(id);
    if (selectedGroup === id) setSelectedGroup('all');
    toast('گروه حذف شد؛ یادداشت‌ها باقی ماندند', {
      action: {
        label: 'واگرد',
        onClick: () => { restoreGroup(id); restoreGroups(previous); },
      },
    });
  }, [clearGroup, deleteGroup, restoreGroup, restoreGroups, toast, selectedGroup]);

  const isTrash = !!activeNote?.deletedAt;

  const groupCounts = useMemo(() => {
    const counts = new Map<GroupFilter, number>([['all', activeNotes.length]]);
    for (const n of activeNotes) {
      const key = n.groupId ?? null;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [activeNotes]);

  const sidebar = (
    <Sidebar
      notes={activeNotes}
      trashedNotes={trashedNotes}
      activeNoteId={activeNoteId}
      view={view}
      onViewChange={handleViewChange}
      onSelect={handleSelect}
      onOpenSearch={() => setPaletteOpen(true)}
      groups={activeGroups}
      groupCounts={groupCounts}
      selectedGroup={selectedGroup}
      onSelectGroup={setSelectedGroup}
      onCreateGroup={createGroup}
      onRenameGroup={renameGroup}
      onDeleteGroup={handleDeleteGroup}
      onMoveNote={setGroup}
      onTogglePin={togglePin}
      onTrashNote={handleTrash}
      onRestoreNote={restoreNote}
      onPermanentDelete={handlePermanentDelete}
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
              groups={activeGroups}
              onSetGroup={setGroup}
              settings={settings}
              token={token}
              tier={tier}
              attachments={attachmentsForNote(activeNote.id)}
              onAttachmentAdded={addAttachment}
              onAttachmentRemoved={dropAttachment}
              onOpenSettings={() => { setSettingsInstant(false); setSettingsOpen(true); }}
            />
          ) : (
            <EmptyState onNewNote={view === 'notes' ? newNote : undefined} />
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
        onNewNote={newNote}
        onToggleSidebar={() => setSidebarOpen(o => !o)}
        dark={resolvedDark}
        onToggleDark={toggleDark}
        onOpenSettings={() => { setSettingsInstant(false); setSettingsOpen(true); }}
      >
        <SyncStatus
          state={syncState}
          email={email}
          pending={notes.filter(n => n.dirty).length}
          onSync={() => void sync()}
          onSignIn={() => setAuthOpen(true)}
          onSignOut={() => { signOut(); clearAttachments(); }}
        />
      </Navbar>

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          notes={notes.filter(n => !n.deletedAt)}
          dark={resolvedDark}
          onSelectNote={handleSelect}
          onNewNote={newNote}
          onToggleDark={toggleDark}
          onOpenTrash={() => handleViewChange('trash')}
          onOpenSettings={() => { setSettingsInstant(true); setSettingsOpen(true); }}
          onOpenShortcuts={() => setShortcuts({ instant: false })}
          groups={activeGroups}
          activeNote={activeNote}
          onMoveToGroup={groupId => { if (activeNote) setGroup(activeNote.id, groupId); }}
        />
      )}

      <AnimatePresence>
        {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} onSubmit={signIn} />}
      </AnimatePresence>

      <AnimatePresence>
        {settingsOpen && (
          <Settings
            settings={settings}
            onUpdate={updateSettings}
            onUpdateAi={updateAi}
            email={email}
            token={token}
            tier={tier}
            isAdmin={isAdmin}
            syncState={syncState}
            settingsState={settingsState}
            pending={notes.filter(n => n.dirty).length}
            onSync={() => void sync()}
            onSignIn={() => { setSettingsOpen(false); setAuthOpen(true); }}
            onSignOut={() => { signOut(); clearAttachments(); }}
            onClose={() => setSettingsOpen(false)}
            onOpenShortcuts={() => setShortcuts({ instant: false })}
            instant={settingsInstant}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {shortcuts && (
          <ShortcutsHelp
            experimentalEditor={settings.experimentalEditor}
            onClose={() => setShortcuts(null)}
            instant={shortcuts.instant}
          />
        )}
      </AnimatePresence>

      <InstallPrompt />
    </div>
  );
}
