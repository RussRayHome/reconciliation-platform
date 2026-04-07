// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockProjectDocuments } = vi.hoisted(() => ({
  mockProjectDocuments: [
    {
      id: 'readme',
      title: 'Project Overview',
      category: 'Overview',
      summary: 'Overview summary',
      audience: 'Reviewers',
      pathLabel: 'README.md',
      content: '# Project Overview\n\n## Intro\n\nOverview body.',
    },
    {
      id: 'setup',
      title: 'Developer Setup',
      category: 'Setup',
      summary: 'Setup summary',
      audience: 'Contributors',
      pathLabel: 'docs/developer-setup.md',
      content: '# Developer Setup\n\n## Install\n\nInstall steps.',
    },
  ] as const,
}));

vi.mock('../lib/docsCatalog', () => ({
  projectDocuments: mockProjectDocuments,
  docsById: new Map(mockProjectDocuments.map((document) => [document.id, document])),
}));

import { DocsOverview } from './DocsOverview';

describe('DocsOverview', () => {
  const scrollIntoViewMock = vi.fn();

  beforeEach(() => {
    cleanup();
    scrollIntoViewMock.mockReset();
    Element.prototype.scrollIntoView = scrollIntoViewMock;
    globalThis.history.replaceState({}, '', '/docs');
    document.title = 'Bank-to-QBO Reconciliation Platform';
  });

  afterEach(() => {
    cleanup();
    globalThis.history.replaceState({}, '', '/');
  });

  it('filters the document list and falls back to the first visible document', async () => {
    const user = userEvent.setup();

    render(<DocsOverview showDeveloperDashboardLink={false} />);

    expect(screen.getByRole('button', { name: /view project overview/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Project Overview' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search documents'), 'setup');

    expect(screen.queryByRole('button', { name: /view project overview/i })).toBeNull();
    expect(screen.getByRole('button', { name: /view developer setup/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Developer Setup' })).toBeInTheDocument();
  });

  it('updates the location hash and scrolls when a section heading is selected', async () => {
    const user = userEvent.setup();

    render(<DocsOverview showDeveloperDashboardLink={true} />);

    await user.click(screen.getByRole('button', { name: 'Intro' }));

    expect(globalThis.location.hash).toContain('readme::readme-intro-1');

    fireEvent(globalThis as unknown as Window, new HashChangeEvent('hashchange'));

    expect(scrollIntoViewMock).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Open developer dashboard' })).toBeInTheDocument();
  });
});