import {
  inlineTokenExpression,
  markdownLinkExpression,
  type MarkdownBlock,
} from '../lib/docsMarkdown';

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

type MarkdownArticleProps = {
  blocks: MarkdownBlock[];
  onOpenImage: (src: string, alt: string) => void;
};

/** Renders parsed Markdown blocks into the documentation viewer article body. */
export function MarkdownArticle({ blocks, onOpenImage }: Readonly<MarkdownArticleProps>) {
  return (
    <article className="docs-markdown" aria-label="Selected document preview">
      {blocks.map((block, index) => {
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
            <pre key={`${block.code.slice(0, 20)}-${index}`} className="docs-code-block">
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
                aria-label={block.alt ? `Open enlarged image: ${block.alt}` : 'Open enlarged image'}
                onClick={() => onOpenImage(block.src, block.alt)}
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
          <p key={`${block.text.slice(0, 20)}-${index}`}>{renderInlineMarkdown(block.text)}</p>
        );
      })}
    </article>
  );
}
