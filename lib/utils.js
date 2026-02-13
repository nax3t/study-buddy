// lib/utils.js

// --- HTML Processing ---

function __studySnapProcessHTML(rawHTML) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHTML, 'text/html');

  const removeSelectors = [
    'script', 'style', 'noscript', 'iframe',
    '[aria-hidden="true"]', '.ad', '.advertisement', '.ads',
    '.cookie-banner', '.cookie-notice'
  ];
  removeSelectors.forEach(sel => {
    doc.querySelectorAll(sel).forEach(el => el.remove());
  });

  const preserveAttrs = new Set([
    'class', 'data-correct', 'data-answer', 'data-score',
    'data-value', 'data-index', 'aria-label', 'title',
    'style', 'type', 'checked', 'disabled', 'href', 'src', 'alt'
  ]);

  doc.querySelectorAll('*').forEach(el => {
    const attrs = [...el.attributes];
    attrs.forEach(attr => {
      if (!preserveAttrs.has(attr.name) && !attr.name.startsWith('data-')) {
        el.removeAttribute(attr.name);
      }
    });
  });

  let cleaned = doc.body.innerHTML;
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  if (cleaned.length > 50000) {
    cleaned = __studySnapTruncate(cleaned, 50000);
  }

  return cleaned;
}

function __studySnapTruncate(html, maxLen) {
  if (html.length <= maxLen) return html;
  const cutPoint = html.lastIndexOf('>', maxLen - 100);
  if (cutPoint > maxLen * 0.7) {
    return html.substring(0, cutPoint + 1) + '\n<!-- Content truncated -->';
  }
  return html.substring(0, maxLen) + '\n<!-- Content truncated -->';
}

function __studySnapDetectContentType(html) {
  const scores = { quiz: 0, article: 0, table: 0, list: 0 };

  const quizPatterns = [
    /class="[^"]*correct[^"]*"/gi,
    /class="[^"]*incorrect[^"]*"/gi,
    /class="[^"]*answer[^"]*"/gi,
    /class="[^"]*question[^"]*"/gi,
    /class="[^"]*quiz[^"]*"/gi,
    /class="[^"]*score[^"]*"/gi,
    /type="radio"/gi,
    /type="checkbox"/gi,
    /data-correct/gi,
    /[\u2713\u2717\u2714\u2718]/g,
    /\b\d+\s*\/\s*\d+\b/g
  ];
  quizPatterns.forEach(p => {
    const m = html.match(p);
    if (m) scores.quiz += m.length;
  });

  if (/<article/i.test(html)) scores.article += 5;
  if (/<p[\s>]/gi.test(html)) scores.article += (html.match(/<p[\s>]/gi) || []).length;
  if (/<table/gi.test(html)) scores.table += (html.match(/<table/gi) || []).length * 3;
  if (/<[uo]l/gi.test(html)) scores.list += (html.match(/<[uo]l/gi) || []).length * 2;

  return scores;
}

// --- Markdown Parser ---

function __studySnapParseMarkdown(md) {
  if (!md) return '';

  let html = md;

  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return '<pre><code class="lang-' + lang + '">' + code.trim() + '</code></pre>';
  });

  // Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Headers
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Horizontal rule
  html = html.replace(/^---+$/gm, '<hr>');

  // Tables
  html = html.replace(/^(\|.+\|)\n(\|[-|\s:]+\|)\n((?:\|.+\|\n?)+)/gm, (_, header, sep, body) => {
    const ths = header.split('|').filter(c => c.trim()).map(c => '<th>' + c.trim() + '</th>').join('');
    const rows = body.trim().split('\n').map(row => {
      const tds = row.split('|').filter(c => c.trim()).map(c => '<td>' + c.trim() + '</td>').join('');
      return '<tr>' + tds + '</tr>';
    }).join('');
    return '<table><thead><tr>' + ths + '</tr></thead><tbody>' + rows + '</tbody></table>';
  });

  // Unordered lists
  html = html.replace(/^(\s*)[-*]\s+(.+)$/gm, (_, indent, text) => {
    const depth = Math.floor(indent.length / 2);
    return '<li data-depth="' + depth + '">' + text + '</li>';
  });

  // Ordered lists
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<oli>$1</oli>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Wrap consecutive <oli> in <ol>
  html = html.replace(/((?:<oli>.*<\/oli>\n?)+)/g, (match) => {
    return '<ol>' + match.replace(/<\/?oli>/g, (t) => t.replace('oli', 'li')) + '</ol>';
  });

  // Links (only allow http/https to prevent javascript: XSS)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    if (/^https?:\/\//i.test(url)) {
      return '<a href="' + url.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
    }
    return text;
  });

  // Paragraphs
  html = html.replace(/^(?!<[a-z/])((?!^\s*$).+)$/gm, '<p>$1</p>');

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');

  return html;
}

// Functions are available as top-level declarations in both contexts:
// - Content script isolated world (injected alongside inspector.js)
// - Side panel page (loaded via <script> tag)
