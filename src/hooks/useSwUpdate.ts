import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useToast } from '../components/ui/toast-context';

/**
 * Shows a persistent toast when a new service worker is waiting, with reload as
 * the action. Never reloads on its own — the user may be mid-sentence.
 */
export function useSwUpdate() {
  const { toast } = useToast();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // Installed PWAs stay open for days without a navigation, and a navigation is
    // the only thing that triggers an update check on its own. Poll hourly so a
    // deploy is noticed the same day.
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setInterval(() => registration.update(), 60 * 60 * 1000);
    },
  });

  useEffect(() => {
    if (!needRefresh) return;
    toast('نسخه جدید آماده است', {
      duration: 0,
      action: { label: 'بارگذاری مجدد', onClick: () => updateServiceWorker(true) },
    });
  }, [needRefresh, toast, updateServiceWorker]);
}