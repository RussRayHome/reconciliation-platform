import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react';
import { docsById, projectDocuments } from '../lib/docsCatalog';
import { type HeadingLink, type MarkdownBlock, parseMarkdown } from '../lib/docsMarkdown';
import { MarkdownArticle } from './MarkdownArticle';
import { SemanticIcon, type SemanticIconName } from './SemanticIcon';

type DocsOverviewProps = {
  appHref?: string;
  docsHref?: string;
  showDeveloperDashboardLink: boolean;
  developerDashboardHref?: string;
  controls?: ReactNode;
};

const categoryOrder = ['Overview', 'Architecture', 'Setup', 'Reference', 'Operations'] as const;
const trackOrder = ['Developer', 'User'] as const;
const docsTrackFilterOrder = ['All', ...trackOrder] as const;
type DocsTrackFilter = (typeof docsTrackFilterOrder)[number];
const docsTrackFilterLabel: Record<DocsTrackFilter, string> = {
  All: 'All Docs',
  Developer: 'Developer Docs',
  User: 'User Docs',
};
const trackSectionTitle: Record<(typeof trackOrder)[number], string> = {
  Developer: 'Developer Documentation',
  User: 'User Documentation',
};
const trackSectionDescription: Record<(typeof trackOrder)[number], string> = {
  Developer:
    'Engineering setup guides, architecture references, API contracts, and operations runbooks.',
  User: 'Analyst-facing guides for running reconciliation, reviewing outcomes, and exporting handoff artifacts.',
};
const categoryIconNames: Record<(typeof categoryOrder)[number], SemanticIconName> = {
  Overview: 'overview',
  Architecture: 'architecture',
  Setup: 'setup',
  Reference: 'reference',
  Operations: 'operations',
};
const docsHashSeparator = '::';

const resolveCategoryIconName = (category: (typeof categoryOrder)[number]): SemanticIconName =>
  categoryIconNames[category];

const resolveInitialLocationState = (): {
  documentId: string;
  sectionAnchorId: string | null;
} => {
  const hashId = globalThis.location.hash.replace(/^#/, '');

  if (!hashId) {
    return {
      documentId: projectDocuments[0]?.id ?? 'readme',
      sectionAnchorId: null,
    };
  }

  const [documentId, sectionAnchorId] = hashId.split(docsHashSeparator);

  if (documentId && docsById.has(documentId)) {
    return {
      documentId,
      sectionAnchorId: sectionAnchorId || null,
    };
  }

  return {
    documentId: projectDocuments[0]?.id ?? 'readme',
    sectionAnchorId: null,
  };
};

const writeDocsLocation = (
  docsHref: string,
  documentId: string,
  sectionAnchorId?: string | null,
): void => {
  const hash = sectionAnchorId ? `${documentId}${docsHashSeparator}${sectionAnchorId}` : documentId;
  globalThis.history.replaceState({}, '', `${docsHref}#${hash}`);
};

/** Renders the Documentation Hub: sidebar navigation, category filters, and Markdown content viewer. */
export function DocsOverview({
  appHref = '/',
  docsHref = '/docs',
  showDeveloperDashboardLink,
  developerDashboardHref = '/developer-dashboard.html',
  controls,
}: Readonly<DocsOverviewProps>) {
  const initialLocationState = resolveInitialLocationState();
  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [activeTrackFilter, setActiveTrackFilter] = useState<DocsTrackFilter>('All');
  const [activeDocumentId, setActiveDocumentId] = useState(initialLocationState.documentId);
  const [activeSectionAnchorId, setActiveSectionAnchorId] = useState<string | null>(
    initialLocationState.sectionAnchorId,
  );
  const [zoomedImage, setZoomedImage] = useState<{ src: string; alt: string } | null>(null);

  const filteredDocuments = useMemo(() => {
    const query = deferredSearchTerm.trim().toLowerCase();

    if (!query) {
      return projectDocuments;
    }

    return projectDocuments.filter((document) => {
      const searchableText = [
        document.title,
        document.category,
        document.summary,
        document.audience,
        document.pathLabel,
      ]
        .join(' ')
        .toLowerCase();

      return searchableText.includes(query);
    });
  }, [deferredSearchTerm]);

  const visibleDocuments = useMemo(
    () =>
      activeTrackFilter === 'All'
        ? filteredDocuments
        : filteredDocuments.filter((document) => document.track === activeTrackFilter),
    [activeTrackFilter, filteredDocuments],
  );

  useEffect(() => {
    const onHashChange = () => {
      const nextLocationState = resolveInitialLocationState();

      if (nextLocationState.documentId && docsById.has(nextLocationState.documentId)) {
        setActiveDocumentId(nextLocationState.documentId);
        setActiveSectionAnchorId(nextLocationState.sectionAnchorId);
      }
    };

    globalThis.addEventListener('hashchange', onHashChange);

    return () => {
      globalThis.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  useEffect(() => {
    const activeStillVisible = visibleDocuments.some(
      (document) => document.id === activeDocumentId,
    );

    if (activeStillVisible) {
      return;
    }

    const fallbackDocument = visibleDocuments[0] ?? projectDocuments[0];

    if (!fallbackDocument) {
      return;
    }

    setActiveDocumentId(fallbackDocument.id);
    setActiveSectionAnchorId(null);
    writeDocsLocation(docsHref, fallbackDocument.id);
  }, [activeDocumentId, docsHref, visibleDocuments]);

  useEffect(() => {
    document.title = 'Documentation Hub';

    return () => {
      document.title = 'Financial Reconciliation Platform';
    };
  }, []);

  const activeDocument =
    visibleDocuments.find((document) => document.id === activeDocumentId) ??
    projectDocuments.find((document) => document.id === activeDocumentId) ??
    projectDocuments[0];

  const parsedBlocks = useMemo(
    () => (activeDocument ? parseMarkdown(activeDocument.content, activeDocument.id) : []),
    [activeDocument],
  );

  const headings = useMemo<HeadingLink[]>(
    () =>
      parsedBlocks
        .filter(
          (block): block is Extract<MarkdownBlock, { type: 'heading' }> => block.type === 'heading',
        )
        .slice(0, 6)
        .map((block) => ({ text: block.text, anchorId: block.anchorId })),
    [parsedBlocks],
  );

  useEffect(() => {
    if (!activeSectionAnchorId) {
      return;
    }

    const targetSection = globalThis.document.getElementById(activeSectionAnchorId);

    if (!targetSection) {
      return;
    }

    const prefersReducedMotion = globalThis.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    )?.matches;

    targetSection.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start',
    });
  }, [activeDocumentId, activeSectionAnchorId, parsedBlocks]);

  useEffect(() => {
    if (!zoomedImage) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setZoomedImage(null);
      }
    };

    globalThis.addEventListener('keydown', onKeyDown);

    return () => {
      globalThis.removeEventListener('keydown', onKeyDown);
    };
  }, [zoomedImage]);

  const documentsByTrack = useMemo(
    () =>
      trackOrder
        .map((track) => {
          const trackDocuments = visibleDocuments.filter((document) => document.track === track);
          const categories = categoryOrder
            .map((category) => ({
              category,
              documents: trackDocuments.filter((document) => document.category === category),
            }))
            .filter((entry) => entry.documents.length > 0);

          return {
            track,
            documents: trackDocuments,
            categories,
          };
        })
        .filter((entry) => entry.documents.length > 0),
    [visibleDocuments],
  );

  const onSelectDocument = (documentId: string) => {
    setActiveDocumentId(documentId);
    setActiveSectionAnchorId(null);
    writeDocsLocation(docsHref, documentId);
  };

  const onSelectSection = (sectionAnchorId: string) => {
    if (!activeDocument) {
      return;
    }

    setActiveSectionAnchorId(sectionAnchorId);
    writeDocsLocation(docsHref, activeDocument.id, sectionAnchorId);
  };

  const openImageModal = (src: string, alt: string) => {
    setZoomedImage({ src, alt: alt || 'Documentation diagram' });
  };

  const closeImageModal = () => {
    setZoomedImage(null);
  };

  return (
    <div className="app-shell">
      <div className="hero-backdrop" />
      <main className="app-layout docs-layout">
        {controls}
        <header className="hero-card docs-hero-card">
          <div>
            <span className="eyebrow">Repository documentation hub</span>
            <h1>Project Documents Overview</h1>
            <p>
              Browse the project&apos;s key guides, references, setup docs, and release notes from
              one place. Select any document to inspect its contents without leaving the app.
            </p>
            <div className="docs-hero-actions">
              <a className="hero-primary-cta" href={appHref}>
                Back to reconciliation app
              </a>
              {showDeveloperDashboardLink ? (
                <a className="hero-primary-cta" href={developerDashboardHref}>
                  Developer Dashboard
                </a>
              ) : null}
            </div>
          </div>

          <div className="hero-meta docs-hero-meta">
            <div>
              <span>Documents in hub</span>
              <strong>{projectDocuments.length}</strong>
            </div>
            <div>
              <span>Categories covered</span>
              <strong>{categoryOrder.length}</strong>
            </div>
            <div>
              <span>Current selection</span>
              <strong>{activeDocument?.pathLabel ?? 'No document selected'}</strong>
            </div>
          </div>
        </header>

        <section className="docs-hub-grid">
          <div className="docs-directory-column">
            <div className="docs-toolbar">
              <label className="docs-search-field" htmlFor="docs-search-input">
                <span>Search documents</span>
                <input
                  id="docs-search-input"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search by title, audience, or file path"
                />
              </label>

              <div className="docs-track-filter" aria-label="Documentation audience filter">
                {docsTrackFilterOrder.map((trackFilter) => (
                  <button
                    key={trackFilter}
                    type="button"
                    className={
                      activeTrackFilter === trackFilter
                        ? 'docs-track-filter-button docs-track-filter-button--active'
                        : 'docs-track-filter-button'
                    }
                    onClick={() => setActiveTrackFilter(trackFilter)}
                    aria-pressed={activeTrackFilter === trackFilter}
                  >
                    {docsTrackFilterLabel[trackFilter]}
                  </button>
                ))}
              </div>
            </div>

            <div className="docs-track-grid">
              {documentsByTrack.map((trackEntry) => (
                <section className="docs-track-group" key={trackEntry.track}>
                  <header className="docs-track-header">
                    <h2 className="docs-track-title">{trackSectionTitle[trackEntry.track]}</h2>
                    <p className="docs-track-description">
                      {trackSectionDescription[trackEntry.track]}
                    </p>
                    <span className="docs-track-count">{trackEntry.documents.length} docs</span>
                  </header>

                  {trackEntry.categories.map((entry) => (
                    <section
                      className="docs-category-group"
                      key={`${trackEntry.track}-${entry.category}`}
                    >
                      <div className="docs-category-header">
                        <h3 className="docs-category-title">
                          <SemanticIcon
                            name={resolveCategoryIconName(entry.category)}
                            className="docs-category-title__icon"
                          />
                          <span>{entry.category}</span>
                        </h3>
                        <span className="docs-category-header__count">
                          {entry.documents.length} docs
                        </span>
                      </div>

                      <div className="docs-card-grid">
                        {entry.documents.map((document) => {
                          const isActive = document.id === activeDocument?.id;

                          return (
                            <button
                              key={document.id}
                              type="button"
                              className={`docs-nav-card ${isActive ? 'docs-nav-card--active' : ''}`}
                              onClick={() => onSelectDocument(document.id)}
                            >
                              <span className="docs-nav-card__path">
                                <SemanticIcon
                                  name={resolveCategoryIconName(document.category)}
                                  className="docs-nav-card__path-icon"
                                />
                                <span>{document.pathLabel}</span>
                              </span>
                              <strong>{`View ${document.title}`}</strong>
                              <p>{document.summary}</p>
                              <span className="docs-nav-card__audience">{document.audience}</span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </section>
              ))}
            </div>
          </div>

          <aside className="docs-viewer-card">
            {activeDocument ? (
              <>
                <div className="docs-viewer-header">
                  <div>
                    <span className="eyebrow docs-eyebrow">
                      <SemanticIcon
                        name={resolveCategoryIconName(activeDocument.category)}
                        className="docs-eyebrow__icon"
                      />
                      <span>{activeDocument.track}</span>
                      <span aria-hidden="true">•</span>
                      <span>{activeDocument.category}</span>
                    </span>
                    <h2>{activeDocument.title}</h2>
                    <p>{activeDocument.summary}</p>
                  </div>
                  <div className="docs-viewer-meta">
                    <span>{activeDocument.pathLabel}</span>
                    <span>{activeDocument.audience}</span>
                  </div>
                </div>

                {headings.length > 0 ? (
                  <div className="docs-heading-strip" aria-label="Document section overview">
                    {headings.map((heading) => (
                      <button
                        key={heading.anchorId}
                        type="button"
                        className={
                          heading.anchorId === activeSectionAnchorId
                            ? 'docs-heading-link docs-heading-link--active'
                            : 'docs-heading-link'
                        }
                        onClick={() => onSelectSection(heading.anchorId)}
                      >
                        {heading.text}
                      </button>
                    ))}
                  </div>
                ) : null}

                <MarkdownArticle blocks={parsedBlocks} onOpenImage={openImageModal} />
              </>
            ) : (
              <p>No documents matched the current filter.</p>
            )}
          </aside>
        </section>
      </main>

      {zoomedImage ? (
        <dialog className="docs-image-modal-backdrop" open aria-label={zoomedImage.alt}>
          <div className="docs-image-modal">
            <button type="button" className="docs-image-modal-close" onClick={closeImageModal}>
              Close
            </button>
            <img src={zoomedImage.src} alt={zoomedImage.alt} className="docs-image-modal-image" />
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
