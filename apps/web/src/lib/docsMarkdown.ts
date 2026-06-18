export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string; anchorId: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'image'; src: string; alt: string }
  | { type: 'link'; href: string; text: string }
  | { type: 'code'; code: string };

export type HeadingLink = {
  text: string;
  anchorId: string;
};

export const markdownLinkExpression = /^\[([^\]]+)\]\(([^)]+)\)$/;
export const inlineTokenExpression = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;

const headingExpression = /^(#{1,3})\s+(.+)$/;
const bulletExpression = /^[-*]\s+(.+)$/;
const orderedExpression = /^\d+\.\s+(.+)$/;
const markdownImageExpression = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const htmlImageExpression = /^<img\s+[^>]*src=["']([^"']+)["'][^>]*>$/i;
const htmlImageAltExpression = /\salt=["']([^"']*)["']/i;

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

export const parseMarkdown = (content: string, documentId: string): MarkdownBlock[] => {
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
