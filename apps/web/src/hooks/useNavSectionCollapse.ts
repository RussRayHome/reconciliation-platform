import { useState } from 'react';

const SECTION_COLLAPSED_STORAGE_PREFIX = 'reconciliation-platform:nav.section';

const loadSectionOpen = (sectionId: string, username: string, defaultOpen: boolean): boolean => {
  try {
    const stored = globalThis.localStorage?.getItem(
      `${SECTION_COLLAPSED_STORAGE_PREFIX}.${sectionId}:${username}`,
    );

    return stored === null ? defaultOpen : stored === 'true';
  } catch {
    return defaultOpen;
  }
};

const persistSectionOpen = (sectionId: string, username: string, isOpen: boolean): void => {
  try {
    globalThis.localStorage?.setItem(
      `${SECTION_COLLAPSED_STORAGE_PREFIX}.${sectionId}:${username}`,
      String(isOpen),
    );
  } catch {
    // Ignore storage failures; collapse state simply resets next session.
  }
};

/** Per-section, per-user collapse state for collapsible nav-rail groups, mirroring the rail's own collapse persistence. */
export function useNavSectionCollapse(
  sectionId: string,
  username: string,
  defaultOpen = true,
): { isOpen: boolean; toggle: () => void } {
  const [isOpen, setIsOpen] = useState(() => loadSectionOpen(sectionId, username, defaultOpen));

  const toggle = (): void => {
    setIsOpen((previous) => {
      const next = !previous;
      persistSectionOpen(sectionId, username, next);
      return next;
    });
  };

  return { isOpen, toggle };
}
