import { useLocation, useNavigate } from 'react-router';

import { RovingTabList } from './RovingTabList';
import { routePaths } from '../routes/routePaths';

type MappingTabId = 'profiles' | 'create' | 'versions' | 'history';

const TABS: ReadonlyArray<{ id: MappingTabId; label: string; path: string }> = [
  { id: 'profiles', label: 'Profiles', path: routePaths.mappingProfiles },
  { id: 'create', label: 'Canvas', path: routePaths.mappingCreate },
  { id: 'versions', label: 'Versions', path: routePaths.mappingVersions },
  { id: 'history', label: 'History', path: routePaths.mappingHistory },
];

/**
 * The mapping family's in-screen tabs (9a–9d, UI-11, #450).
 *
 * **Tabs, not rail children, and that is a recorded decision rather than a layout preference.** A
 * rail disclosure for Mapping was built and reverted: it broke rail identity and pushed the account
 * row off the 900px card. So Mapping stays a single rail leaf and the four screens move between
 * themselves here.
 *
 * Each tab is a real route, so the browser back button, a bookmark and a deep link all behave. A
 * tab strip that only swapped local state would silently break all three.
 */
export function MappingTabs() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Matched exactly, not by prefix: `/mapping/rules` and `/mapping/rules/versions` are the MATCHING
  // RULES family, a different screen that happens to share the `/mapping` stem. A prefix match
  // would light up a mapping tab while the reader is somewhere else entirely.
  const active = TABS.find((tab) => tab.path === pathname)?.id;
  if (!active) {
    return null;
  }

  return (
    <RovingTabList
      items={TABS.map(({ id, label }) => ({ id, label }))}
      activeId={active}
      onSelect={(id) => {
        const target = TABS.find((tab) => tab.id === id);
        // void: react-router's navigate returns a promise this caller has no use for.
        if (target) void navigate(target.path);
      }}
      ariaLabel="Mapping screens"
      tabIdPrefix="mapping-tab"
      panelIdPrefix="mapping-panel"
      listClassName="mapping-tabs"
      tabClassName="mapping-tabs__tab"
      activeTabClassName="mapping-tabs__tab--active"
    />
  );
}
