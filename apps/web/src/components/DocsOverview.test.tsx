// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const eventTargetWindow = globalThis as unknown as Window;

const { mockProjectDocuments } = vi.hoisted(() => ({
  mockProjectDocuments: [
    {
      id: 'readme',
      title: 'Project Overview',
      track: 'User',
      category: 'Overview',
      summary: 'Overview summary',
      audience: 'Reviewers',
      pathLabel: 'README.md',
      content: '# Project Overview\n\n## Intro\n\nOverview body.',
    },
    {
      id: 'setup',
      title: 'Developer Setup',
      track: 'Developer',
      category: 'Setup',
      summary: 'Setup summary',
      audience: 'Contributors',
      pathLabel: 'docs/developer-setup.md',
      content: '# Developer Setup\n\n## Install\n\nInstall steps.',
    },
    {
      id: 'architecture',
      title: 'Architecture',
      track: 'Developer',
      category: 'Architecture',
      summary: 'Architecture summary',
      audience: 'Engineers',
      pathLabel: 'docs/architecture.md',
      content:
        '# Architecture\n\n## System Diagram\n\n<img src="/assets/architecture.png" alt="System architecture" />\n\n![Markdown architecture image](/assets/architecture.png)\n\n[Open full-size architecture diagram](/assets/architecture.png)\n\nUse this [inline architecture link](/assets/architecture.png) for context.',
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
    document.title = 'Financial Reconciliation Platform';
  });

  afterEach(() => {
    cleanup();
    globalThis.history.replaceState({}, '', '/');
  });

  it('filters the document list and falls back to the first visible document', async () => {
    const user = userEvent.setup();

    render(<DocsOverview controls={null} />);

    expect(screen.getByRole('button', { name: /view project overview/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Project Overview' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search documents'), 'setup');

    expect(screen.queryByRole('button', { name: /view project overview/i })).toBeNull();
    expect(screen.getByRole('button', { name: /view developer setup/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Developer Setup' })).toBeInTheDocument();
  });

  it('filters the navigation by audience track buttons', async () => {
    const user = userEvent.setup();

    render(<DocsOverview controls={null} />);

    expect(screen.getByRole('button', { name: 'All Docs' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /view project overview/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Developer Docs' }));

    expect(screen.getByRole('button', { name: 'Developer Docs' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('button', { name: /view project overview/i })).toBeNull();
    expect(screen.getByRole('button', { name: /view developer setup/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'User Docs' }));

    expect(screen.getByRole('button', { name: 'User Docs' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /view project overview/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /view developer setup/i })).toBeNull();
  });

  it('updates the location hash and scrolls when a section heading is selected', async () => {
    const user = userEvent.setup();
    globalThis.history.replaceState({}, '', '/dev/docs');

    render(<DocsOverview appHref="/dev" docsHref="/dev/docs" controls={null} />);

    await user.click(screen.getByRole('button', { name: 'Intro' }));

    expect(globalThis.location.hash).toContain('readme::readme-intro-1');

    fireEvent(eventTargetWindow, new HashChangeEvent('hashchange'));

    expect(scrollIntoViewMock).toHaveBeenCalled();
    expect(globalThis.location.pathname).toBe('/dev/docs');
  });

  it('renders image and link markdown blocks for document content', async () => {
    const user = userEvent.setup();

    render(<DocsOverview controls={null} />);

    await user.click(screen.getByRole('button', { name: /view architecture/i }));

    expect(screen.getByRole('img', { name: 'System architecture' })).toHaveAttribute(
      'src',
      '/assets/architecture.png',
    );
    expect(screen.getByRole('img', { name: 'Markdown architecture image' })).toHaveAttribute(
      'src',
      '/assets/architecture.png',
    );
    expect(
      screen.getByRole('link', { name: 'Open full-size architecture diagram' }),
    ).toHaveAttribute('href', '/assets/architecture.png');
    expect(screen.getByRole('link', { name: 'inline architecture link' })).toHaveAttribute(
      'href',
      '/assets/architecture.png',
    );
  });

  it('opens and closes an enlarged image modal from the docs diagram', async () => {
    const user = userEvent.setup();

    render(<DocsOverview controls={null} />);

    await user.click(screen.getByRole('button', { name: /view architecture/i }));
    await user.click(
      screen.getByRole('button', { name: /open enlarged image: system architecture/i }),
    );

    const dialog = screen.getByRole('dialog', { name: 'System architecture' });
    expect(within(dialog).getByRole('img', { name: 'System architecture' })).toBeInTheDocument();

    fireEvent.keyDown(eventTargetWindow, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'System architecture' })).toBeNull();
  });
});
