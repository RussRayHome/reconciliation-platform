// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';

import { RuleVersionHeader } from './AppWorkspacePanels';
import { RULE_VERSION_HEADER_FIXTURES } from './ruleVersionHeaderFixtures';

afterEach(() => {
  cleanup();
});

const getFixture = (name: string) => {
  const fixture = RULE_VERSION_HEADER_FIXTURES.find((item) => item.name === name);
  if (!fixture) {
    throw new Error(`No fixture named "${name}"`);
  }
  return fixture;
};

describe('RuleVersionHeader', () => {
  it('exposes exactly the five states T4 requires, each reachable by name', () => {
    expect(RULE_VERSION_HEADER_FIXTURES.map((fixture) => fixture.state).sort()).toEqual(
      ['admin-editable', 'draft-pending', 'not-applied', 'read-only', 'superseded'].sort(),
    );
  });

  it('admin-editable: shows the active badge, publish metadata, and no banner', () => {
    render(<RuleVersionHeader {...getFixture('admin-editable')} />);

    expect(screen.getByText('v7 · ACTIVE')).toBeTruthy();
    expect(screen.getByText(/Published by M\. Ortega/)).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    const editButton = screen.getByRole('button', { name: 'Edit as draft' }) as HTMLButtonElement;
    expect(editButton.disabled).toBe(false);
  });

  it('read-only: shows one whole-screen banner, not per-row text, and disables Edit as draft', () => {
    render(<RuleVersionHeader {...getFixture('read-only')} />);

    const banners = screen.getAllByRole('status');
    expect(banners).toHaveLength(1);
    // 13c (#451): the banner states the REASON, not just the restriction -- naming the
    // two-person rule is what tells an analyst who to ask.
    expect(banners[0]?.textContent).toContain('Changing a rule needs admin');
    expect(banners[0]?.textContent).toContain('a second person must approve');
    const editButton = screen.getByRole('button', { name: 'Edit as draft' }) as HTMLButtonElement;
    expect(editButton.disabled).toBe(true);
  });

  it('draft-pending: shows the draft badge, who it is waiting on, and a Publish now action for admins', () => {
    render(<RuleVersionHeader {...getFixture('draft-pending')} />);

    expect(screen.getByText('v8 · DRAFT')).toBeTruthy();
    expect(screen.getByText(/Waiting on VP Finance/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish now' })).toBeTruthy();
  });

  it('draft-pending: hides Publish now for a non-admin viewer', () => {
    const fixture = getFixture('draft-pending');
    render(<RuleVersionHeader {...fixture} canAdjustVarianceDefaults={false} />);

    expect(screen.queryByRole('button', { name: 'Publish now' })).toBeNull();
  });

  it('not-applied: renders the exact warning copy and disables the edit action is left to the caller (state alone signals it)', () => {
    render(<RuleVersionHeader {...getFixture('not-applied')} />);

    expect(
      screen.getByText('Not applied — thresholds are not reaching the engine'),
    ).toBeTruthy();
    expect(screen.getByText('defaultReconciliationConfig')).toBeTruthy();
    expect(
      screen.getByText((_, element) => {
        const hasText = (node: Element | null) =>
          Boolean(node?.textContent?.includes('threaded into the reconciliation pipeline'));
        return (
          hasText(element) &&
          Array.from(element?.children ?? []).every((child) => !hasText(child))
        );
      }),
    ).toBeTruthy();
  });

  it('superseded: shows the superseded badge and a route back to active', () => {
    const onBackToActive = vi.fn();
    render(<RuleVersionHeader {...getFixture('superseded')} onBackToActive={onBackToActive} />);

    expect(screen.getByText('v6 · SUPERSEDED')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to active' }));
    expect(onBackToActive).toHaveBeenCalledOnce();
  });
});
