/**
 * Установка приложения на телефон.
 *
 * Браузеры на Android/Chrome сообщают о готовности установки событием
 * `beforeinstallprompt` — его нужно перехватить и вызвать позже по кнопке.
 * В Safari на iOS такого события нет: там установка делается вручную через
 * «Поделиться → На экран „Домой“», поэтому возвращаем и признак iOS.
 */

import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallPromptState {
  /** Браузер готов показать системное окно установки. */
  canInstall: boolean;
  /** Пользователь только что установил приложение. */
  installed: boolean;
  /** Открыто уже как установленное приложение (без адресной строки). */
  isStandalone: boolean;
  /** Устройство на iOS — установка делается вручную. */
  isIos: boolean;
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

export function useInstallPrompt(): InstallPromptState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isStandalone, setIsStandalone] = useState(
    typeof window !== 'undefined' &&
      (window.matchMedia?.('(display-mode: standalone)').matches === true ||
        (window.navigator as { standalone?: boolean }).standalone === true),
  );

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
      setIsStandalone(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return 'unavailable' as const;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    setDeferred(null);
    return choice.outcome;
  }, [deferred]);

  const isIos = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);

  return { canInstall: Boolean(deferred), installed, isStandalone, isIos, install };
}
