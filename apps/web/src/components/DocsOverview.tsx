import { useDeferredValue, useEffect, useMemo, useState } from 'react';

import { SectionCard } from '@recon/ui';
import { docsById, projectDocuments } from '../lib/docsCatalog';
import { SemanticIcon, type SemanticIconName } from './SemanticIcon';

type DocsOverviewProps = {
  appHref?: string;
  docsHref?: string;
  showDeveloperDashboardLink: boolean;
  developerDashboardHref?: string;
};

type HeadingLink = {
  text: string;
  anchorId: string;
};

type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string; anchorId: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'image'; src: string; alt: string }
  | { type: 'link'; href: string; text: string }
  | { type: 'code'; code: string };

const categoryOrder = ['Overview', 'Architecture', 'Setup', 'Reference', 'Operations'] as const;
const categoryIconNames: Record<(typeof categoryOrder)[number], SemanticIconName> = {
  Overview: 'overview',
  Architecture: 'architecture',
  Setup: 'setup',
  Reference: 'reference',
  Operations: 'operations',
};
const docsHashSeparator = '::';
const headingExpression = /^(#{1,3})\s+(.+)$/;
const bulletExpression = /^[-*]\s+(.+)$/;
const orderedExpression = /^\d+\.\s+(.+)$/;
const markdownImageExpression = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const markdownLinkExpression = /^\[([^\]]+)\]\(([^)]+)\)$/;
const inlineTokenExpression = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
const htmlImageExpression = /^<img\s+[^>]*src=["']([^"']+)["'][^>]*>$/i;
const htmlImageAltExpression = /\salt=["']([^"']*)["']/i;

const resolveCategoryIconName = (category: (typeof categoryOrder)[number]): SemanticIconName =>
  categoryIconNames[category];

const parseSpecialMarkdownBlock = (trimmedLine: string): MarkdownBlock | null => {
  const markdownImageMatch = markdownImageExpression.exec(trimmedLine);
  if (markdownImageMatch) {
    return {
      type: 'image',
      alt: markdownImageMatch[1]?.trim() ?? '',
      src: markdownImageMatch[2]?.trim() ?? '',
    };
  }

  const htmlImageMatch = htmlImageExpression.exec(trimmedLine);
  if (htmlImageMatch) {
    const altMatch = htmlImageAltExpression.exec(trimmedLine);
    return {
      type: 'image',
      alt: altMatch?.[1]?.trim() ?? '',
      src: htmlImageMatch[1]?.trim() ?? '',
    };
  }

  const markdownLinkMatch = markdownLinkExpression.exec(trimmedLine);
  if (markdownLinkMatch) {
    return {
      type: 'link',
      text: markdownLinkMatch[1]?.trim() ?? '',
      href: markdownLinkMatch[2]?.trim() ?? '',
    };
  }

  return null;
};

const slugifyHeading = (text: string): string =>
  text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 60);

const buildHeadingAnchorId = (
  documentId: string,
  headingText: string,
  occurrence: number,
): string => `${documentId}-${slugifyHeading(headingText) || 'section'}-${occurrence}`;

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

const parseMarkdown = (content: string, documentId: string): MarkdownBlock[] => {
  const blocks: MarkdownBlock[] = [];
  const lines = content.replaceAll('\r\n', '\n').split('\n');
  const headingOccurrences = new Map<string, number>();
  let paragraphLines: string[] = [];
  let listState: { ordered: boolean; items: string[] } | null = null;
  let codeLines: string[] | null = null;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }

    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') });
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listState) {
      return;
    }

    blocks.push({ type: 'list', ordered: listState.ordered, items: listState.items });
    listState = null;
  };

  const flushCode = () => {
    if (!codeLines) {
      return;
    }

    blocks.push({ type: 'code', code: codeLines.join('\n') });
    codeLines = null;
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    const headingMatch = headingExpression.exec(line);
    const bulletMatch = bulletExpression.exec(line);
    const orderedMatch = orderedExpression.exec(line);
    const specialBlock = parseSpecialMarkdownBlock(trimmed);

    if (trimmed.startsWith('```')) {
      flushParagraph();
      flushList();

      if (codeLines) {
        flushCode();
      } else {
        codeLines = [];
      }

      return;
    }

    if (codeLines) {
      codeLines.push(line);
      return;
    }

    if (headingMatch) {
      const headingDepth = headingMatch[1]?.length ?? 1;
      const headingText = headingMatch[2]?.trim() ?? '';
      const nextOccurrence = (headingOccurrences.get(headingText) ?? 0) + 1;

      headingOccurrences.set(headingText, nextOccurrence);

      flushParagraph();
      flushList();
      blocks.push({
        type: 'heading',
        level: Math.min(headingDepth, 3) as 1 | 2 | 3,
        anchorId: buildHeadingAnchorId(documentId, headingText, nextOccurrence),
        text: headingText,
      });
      return;
    }

    if (specialBlock) {
      flushParagraph();
      flushList();
      blocks.push(specialBlock);
      return;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      return;
    }

    if (bulletMatch) {
      flushParagraph();

      if (!listState || listState.ordered) {
        flushList();
        listState = { ordered: false, items: [] };
      }

      listState.items.push(bulletMatch[1] ?? '');
      return;
    }

    if (orderedMatch) {
      flushParagraph();

      if (listState?.ordered !== true) {
        flushList();
        listState = { ordered: true, items: [] };
      }

      listState.items.push(orderedMatch[1] ?? '');
      return;
    }

    flushList();
    paragraphLines.push(trimmed);
  });

  flushParagraph();
  flushList();
  flushCode();

  return blocks;
};

const renderInlineMarkdown = (text: string) =>
  text
    .split(inlineTokenExpression)
    .filter((part) => part.length > 0)
    .map((part, index) => {
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
      }

      const linkMatch = markdownLinkExpression.exec(part);
      if (linkMatch) {
        return (
          <a key={`${part}-${index}`} href={linkMatch[2]}>
            {linkMatch[1]}
          </a>
        );
      }

      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
      }

      return <span key={`${part}-${index}`}>{part}</span>;
    });

export function DocsOverview({
  appHref = '/',
  docsHref = '/docs',
  showDeveloperDashboardLink,
  developerDashboardHref = '/developer-dashboard.html',
}: Readonly<DocsOverviewProps>) {
  const initialLocationState = resolveInitialLocationState();
  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearchTerm = useDeferredValue(searchTerm);
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
    const activeStillVisible = filteredDocuments.some(
      (document) => document.id === activeDocumentId,
    );

    if (activeStillVisible) {
      return;
    }

    const fallbackDocument = filteredDocuments[0] ?? projectDocuments[0];

    if (!fallbackDocument) {
      return;
    }

    setActiveDocumentId(fallbackDocument.id);
    setActiveSectionAnchorId(null);
    writeDocsLocation(docsHref, fallbackDocument.id);
  }, [activeDocumentId, docsHref, filteredDocuments]);

  useEffect(() => {
    document.title = 'Documentation Hub';

    return () => {
      document.title = 'Financial Reconciliation Platform';
    };
  }, []);

  const activeDocument =
    filteredDocuments.find((document) => document.id === activeDocumentId) ??
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

  const documentsByCategory = useMemo(
    () =>
      categoryOrder
        .map((category) => ({
          category,
          documents: filteredDocuments.filter((document) => document.category === category),
        }))
        .filter((entry) => entry.documents.length > 0),
    [filteredDocuments],
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

        <SectionCard
          title="Document Navigator"
          description="Filter the documentation set and choose which project document to inspect."
        >
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
            <p className="docs-toolbar-note">
              The hub focuses on the project&apos;s primary guides and operational references.
            </p>
          </div>
        </SectionCard>

        <section className="docs-hub-grid">
          <div className="docs-directory-column">
            {documentsByCategory.map((entry) => (
              <section className="docs-category-group" key={entry.category}>
                <div className="docs-category-header">
                  <h2 className="docs-category-title">
                    <SemanticIcon
                      name={resolveCategoryIconName(entry.category)}
                      className="docs-category-title__icon"
                    />
                    <span>{entry.category}</span>
                  </h2>
                  <span className="docs-category-header__count">{entry.documents.length} docs</span>
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

                <article className="docs-markdown" aria-label="Selected document preview">
                  {parsedBlocks.map((block, index) => {
                    if (block.type === 'heading') {
                      if (block.level === 1) {
                        return (
                          <h1 id={block.anchorId} key={`${block.text}-${index}`}>
                            {block.text}
                          </h1>
                        );
                      }

                      if (block.level === 2) {
                        return (
                          <h2 id={block.anchorId} key={`${block.text}-${index}`}>
                            {block.text}
                          </h2>
                        );
                      }

                      return (
                        <h3 id={block.anchorId} key={`${block.text}-${index}`}>
                          {block.text}
                        </h3>
                      );
                    }

                    if (block.type === 'code') {
                      return (
                        <pre
                          key={`${block.code.slice(0, 20)}-${index}`}
                          className="docs-code-block"
                        >
                          <code>{block.code}</code>
                        </pre>
                      );
                    }

                    if (block.type === 'image') {
                      return (
                        <figure key={`${block.src}-${index}`} className="docs-markdown-image-shell">
                          <button
                            type="button"
                            className="docs-image-zoom-trigger"
                            aria-label={
                              block.alt
                                ? `Open enlarged image: ${block.alt}`
                                : 'Open enlarged image'
                            }
                            onClick={() => openImageModal(block.src, block.alt)}
                          >
                            <img
                              src={block.src}
                              alt={block.alt}
                              className="docs-markdown-image"
                              loading="lazy"
                            />
                          </button>
                        </figure>
                      );
                    }

                    if (block.type === 'link') {
                      return (
                        <p key={`${block.href}-${index}`}>
                          <a href={block.href}>{block.text}</a>
                        </p>
                      );
                    }

                    if (block.type === 'list') {
                      const ListTag = block.ordered ? 'ol' : 'ul';

                      return (
                        <ListTag key={`${block.items[0] ?? 'list'}-${index}`}>
                          {block.items.map((item) => (
                            <li key={item}>{renderInlineMarkdown(item)}</li>
                          ))}
                        </ListTag>
                      );
                    }

                    return (
                      <p key={`${block.text.slice(0, 20)}-${index}`}>
                        {renderInlineMarkdown(block.text)}
                      </p>
                    );
                  })}
                </article>
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
