import { Fragment, useMemo } from 'react';

/**
 * A small, dependency-free renderer for the markdown subset teachers actually
 * use in problem statements: fenced code, headings, lists, bold/italic and
 * inline code.
 *
 * It builds React elements directly — no dangerouslySetInnerHTML — so a
 * statement can never inject markup into the exam page.
 */

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_)/g;

/** `![alt](url)` on a line of its own. */
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;

/**
 * Only same-origin uploads are rendered. A statement is teacher-authored, but
 * an exam page should not be fetching images from arbitrary third-party hosts —
 * that would leak every student's IP and viewing time to whoever owns them.
 */
const isSafeImageSrc = (src) => src.startsWith('/uploads/');

function renderInline(text, keyPrefix) {
  const parts = String(text).split(INLINE).filter((p) => p !== undefined && p !== '');

  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={key}
          className="mono rounded px-1 py-0.5"
          style={{ background: 'var(--surface-3)' }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (
      ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) &&
      part.length > 2
    ) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

function parseBlocks(source) {
  const lines = String(source || '').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code
    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const body = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      blocks.push({ type: 'code', lang, text: body.join('\n') });
      continue;
    }

    // Image on its own line
    const image = IMAGE_LINE.exec(line.trim());
    if (image) {
      blocks.push({ type: 'image', alt: image[1], src: image[2] });
      i += 1;
      continue;
    }

    // Heading
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }

    // Lists (bullet or ordered)
    const isBullet = (l) => /^\s*[-*+]\s+/.test(l);
    const isOrdered = (l) => /^\s*\d+[.)]\s+/.test(l);
    if (isBullet(line) || isOrdered(line)) {
      const ordered = isOrdered(line);
      const items = [];
      while (i < lines.length && (ordered ? isOrdered(lines[i]) : isBullet(lines[i]))) {
        items.push(lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // Blank line
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Paragraph — consume until a blank line or the start of another block
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trimStart().startsWith('```') &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !isBullet(lines[i]) &&
      !isOrdered(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: para.join('\n') });
  }

  return blocks;
}

export default function Markdown({ children, className = '' }) {
  const blocks = useMemo(() => parseBlocks(children), [children]);

  return (
    <div className={`flex flex-col gap-3 leading-relaxed ${className}`}>
      {blocks.map((block, i) => {
        const key = `b${i}`;
        switch (block.type) {
          case 'code':
            return (
              <pre key={key} className="io-block">
                {block.text}
              </pre>
            );
          case 'image':
            if (!isSafeImageSrc(block.src)) {
              return (
                <p key={key} className="text-xs" style={{ color: 'var(--warn)' }}>
                  [image not shown — only uploaded diagrams are displayed]
                </p>
              );
            }
            return (
              <img
                key={key}
                src={block.src}
                alt={block.alt || 'Diagram'}
                // Deliberately eager. A diagram in a question IS the question —
                // a GATE circuit or a figure the options refer to — and lazy
                // loading was observed not to fire for an image that was
                // already on screen, leaving a blank space where the question
                // should be. A student cannot answer what they cannot see, and
                // no saving in bandwidth is worth that risk mid-exam.
                loading="eager"
                decoding="async"
                className="max-w-full rounded-lg border"
                style={{ background: 'var(--surface)' }}
              />
            );
          case 'heading': {
            const size =
              block.level === 1 ? 'text-lg' : block.level === 2 ? 'text-base' : 'text-sm';
            return (
              <p key={key} className={`${size} font-bold`}>
                {renderInline(block.text, key)}
              </p>
            );
          }
          case 'list': {
            const List = block.ordered ? 'ol' : 'ul';
            return (
              <List
                key={key}
                className={`ml-5 flex flex-col gap-1 ${block.ordered ? 'list-decimal' : 'list-disc'}`}
              >
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </List>
            );
          }
          default:
            return (
              <p key={key} className="whitespace-pre-wrap">
                {renderInline(block.text, key)}
              </p>
            );
        }
      })}
    </div>
  );
}
