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
  } = useRegisterSW();

  useEffect(() => {
    if (!needRefresh) return;
    toast('نسخه جدید آماده است', {
      duration: 0,
      action: { label: 'بارگذاری مجدد', onClick: () => updateServiceWorker(true) },
    });
  }, [needRefresh, toast, updateServiceWorker]);
}