import { useEffect, useRef, type RefObject } from 'react';

/**
 * Closes a native `<details>` popover on an outside pointer press or Escape.
 *
 * `<details>` has no dismissal behaviour of its own: once open it stays open until its own summary
 * is clicked again, so a run-bar popover would sit over the page while the user clicked elsewhere.
 * Listeners are attached once and only act while the element is open, so several popovers can share
 * the hook without fighting each other.
 */
export const useDismissableDetails = (): RefObject<HTMLDetailsElement | null> => {
  const ref = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    const close = (): void => {
      const element = ref.current;
      if (element?.open) {
        element.open = false;
      }
    };

    const onPointerDown = (event: PointerEvent): void => {
      const element = ref.current;
      if (!element?.open) {
        return;
      }
      // A press on the summary itself is the browser's own toggle -- leave it alone.
      if (event.target instanceof Node && element.contains(event.target)) {
        return;
      }
      close();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        close();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return ref;
};
