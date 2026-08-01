import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { springUI } from '../lib/motion';
import { getItem, setItem } from '../utils/storage';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';

const DISMISS_KEY = 'notebook_install_dismissed';

/** Chrome fires this with a `prompt()` the page may call later. Not in lib.dom yet. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

/**
 * Install banner. Shows once: dismissing or installing writes a flag, and the
 * browser stops firing the event after a successful install anyway.
 */
export function InstallPrompt() {
  const [event, setEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    if (getItem(DISMISS_KEY, false)) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const close = () => {
    setItem(DISMISS_KEY, true);
    setEvent(null);
  };

  return (
    <AnimatePresence>
      {event && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={springUI}
          className="glass-panel fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-sm items-center gap-3 rounded-xl p-3 text-sm text-ink"
          style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          <span className="flex-1">دفترچه را روی دستگاه نصب کنید</span>
          <Button
            variant="primary"
            size="sm"
            onClick={() => { void event.prompt(); close(); }}
          >
            نصب
          </Button>
          <IconButton label="بستن" onClick={close}>
            <X size={16} />
          </IconButton>
        </motion.div>
      )}
    </AnimatePresence>
  );
}