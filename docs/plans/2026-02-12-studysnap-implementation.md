# StudySnap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Chrome extension that lets users select webpage elements and transform them into study materials using Claude AI.

**Architecture:** Manifest V3 extension with on-demand content script injection, background service worker for Claude API calls with SSE streaming, side panel for results display with interactive UIs (flashcards, quiz, key terms), and Shadow DOM isolation for all injected page elements.

**Tech Stack:** Chrome Extension Manifest V3, vanilla JavaScript, Claude API (claude-sonnet-4-5-20250929), no external dependencies.

**Note:** This is a Chrome extension — no test framework. Each task is verified by loading the extension at `chrome://extensions` (Developer mode → Load unpacked). Reload the extension after each change.

---

### Task 1: Project Scaffold

**Files:**
- Create: `manifest.json`
- Create: `icons/icon-16.png`, `icons/icon-48.png`, `icons/icon-128.png`
- Create: `background/service-worker.js` (stub)
- Create: `sidepanel/sidepanel.html` (stub)

**Step 1: Create folder structure**

```bash
mkdir -p background content sidepanel icons lib
```

**Step 2: Generate placeholder icons**

```bash
python3 -c "
import struct, zlib

def png(w, h, r, g, b):
    raw = b''
    for y in range(h):
        raw += b'\x00'
        for x in range(w):
            cx, cy = w//2, h//2
            rad = min(w, h)//2 - 1
            if (x-cx)**2 + (y-cy)**2 <= rad**2:
                raw += bytes([r, g, b, 255])
            else:
                raw += bytes([0, 0, 0, 0])
    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' +
            chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(raw)) +
            chunk(b'IEND', b''))

for s in [16, 48, 128]:
    open(f'icons/icon-{s}.png','wb').write(png(s, s, 59, 130, 246))
"
```

**Step 3: Create manifest.json**

```json
{
  "manifest_version": 3,
  "name": "StudySnap",
  "version": "1.0.0",
  "description": "Select any content on a webpage and transform it into study materials with AI.",
  "permissions": [
    "activeTab",
    "sidePanel",
    "storage",
    "scripting"
  ],
  "host_permissions": [
    "https://api.anthropic.com/*"
  ],
  "background": {
    "service_worker": "background/service-worker.js"
  },
  "action": {
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    },
    "default_title": "StudySnap - Select content to study"
  },
  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

**Step 4: Create service worker stub**

```js
// background/service-worker.js
console.log('StudySnap service worker loaded');

chrome.action.onClicked.addListener(async (tab) => {
  console.log('StudySnap icon clicked on tab', tab.id);
});
```

**Step 5: Create side panel stub**

```html
<!-- sidepanel/sidepanel.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>StudySnap</title>
</head>
<body>
  <h1>StudySnap</h1>
  <p>Select content on a page to get started.</p>
</body>
</html>
```

**Step 6: Verify — load extension at chrome://extensions, confirm icon appears**

**Step 7: Commit**

```bash
git add manifest.json icons/ background/service-worker.js sidepanel/sidepanel.html
git commit -m "feat: project scaffold with manifest, icons, stubs"
```

---

### Task 2: Service Worker — Inspector Injection

**Files:**
- Modify: `background/service-worker.js`
- Create: `content/inspector.js` (minimal stub)

**Step 1: Create minimal inspector stub**

```js
// content/inspector.js
(() => {
  if (window.__studySnapInitialized) {
    window.__studySnapToggle();
    return;
  }
  window.__studySnapInitialized = true;

  let isActive = false;

  function activate() {
    isActive = true;
    console.log('StudySnap inspector activated');
    // Visual indicator for testing
    document.body.style.outline = '3px solid #3B82F6';
  }

  function deactivate() {
    isActive = false;
    document.body.style.outline = '';
    console.log('StudySnap inspector deactivated');
    chrome.runtime.sendMessage({ type: 'inspector-deactivated' });
  }

  window.__studySnapToggle = () => {
    if (isActive) deactivate();
    else activate();
  };

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'toggle-inspector') {
      window.__studySnapToggle();
      sendResponse({ active: isActive });
    }
  });

  activate();
})();
```

**Step 2: Update service worker to inject content scripts**

```js
// background/service-worker.js
console.log('StudySnap service worker loaded');

chrome.action.onClicked.addListener(async (tab) => {
  // Skip chrome:// and edge:// pages
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
    console.warn('Cannot inject into this page');
    return;
  }

  try {
    // Try toggling existing inspector
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'toggle-inspector' });
    console.log('Inspector toggled:', response);
  } catch (e) {
    // Not injected yet — inject now
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/inspector.js']
    });
    console.log('Inspector injected into tab', tab.id);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'inspector-deactivated') {
    console.log('Inspector deactivated on tab', sender.tab?.id);
  }
});
```

**Step 3: Verify — click icon on a webpage, see blue outline; click again, outline removed**

**Step 4: Commit**

```bash
git add background/service-worker.js content/inspector.js
git commit -m "feat: service worker injects and toggles inspector"
```

---

### Task 3: Inspector — Shadow DOM + Hover Highlight

**Files:**
- Modify: `content/inspector.js` (full rewrite)

**Step 1: Write the complete inspector with hover highlighting**

```js
// content/inspector.js
(() => {
  if (window.__studySnapInitialized) {
    window.__studySnapToggle();
    return;
  }
  window.__studySnapInitialized = true;

  // State
  let isActive = false;
  let currentElement = null;
  let selectedElement = null;
  let shadowHost = null;
  let shadow = null;
  let highlightEl = null;
  let tagEl = null;

  const STYLES = `
    :host {
      all: initial;
      position: fixed;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      z-index: 2147483647;
      pointer-events: none;
    }

    .ss-highlight {
      position: fixed;
      pointer-events: none;
      background: rgba(59, 130, 246, 0.12);
      border: 2px solid #3B82F6;
      border-radius: 3px;
      transition: top 0.1s ease, left 0.1s ease, width 0.1s ease, height 0.1s ease;
      z-index: 2147483646;
    }

    .ss-highlight.selected {
      border-color: #2563EB;
      background: rgba(37, 99, 235, 0.08);
      animation: ss-pulse 1.5s ease-in-out infinite;
    }

    @keyframes ss-pulse {
      0%, 100% { border-color: #2563EB; box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.3); }
      50% { border-color: #3B82F6; box-shadow: 0 0 0 4px rgba(59, 130, 246, 0); }
    }

    .ss-tag {
      position: fixed;
      pointer-events: none;
      background: #3B82F6;
      color: white;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      line-height: 1;
      padding: 3px 6px;
      border-radius: 3px;
      white-space: nowrap;
      z-index: 2147483647;
      opacity: 0.95;
    }

    .ss-action-panel {
      position: fixed;
      pointer-events: auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.1);
      padding: 16px;
      width: 280px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      animation: ss-fadeIn 0.15s ease-out;
    }

    @keyframes ss-fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .ss-action-panel h3 {
      margin: 0 0 12px 0;
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
    }

    .ss-actions-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .ss-action-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 12px 8px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #f8fafc;
      cursor: pointer;
      transition: all 0.15s ease;
      font-family: inherit;
    }

    .ss-action-btn:hover {
      background: #eff6ff;
      border-color: #3B82F6;
      transform: translateY(-1px);
    }

    .ss-action-btn .ss-icon {
      font-size: 20px;
    }

    .ss-action-btn .ss-label {
      font-size: 12px;
      font-weight: 500;
      color: #334155;
    }

    .ss-cancel-btn {
      display: block;
      width: 100%;
      margin-top: 8px;
      padding: 8px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: #94a3b8;
      font-size: 12px;
      cursor: pointer;
      font-family: inherit;
    }

    .ss-cancel-btn:hover {
      background: #f1f5f9;
      color: #64748b;
    }
  `;

  function createShadowDOM() {
    shadowHost = document.createElement('div');
    shadowHost.setAttribute('data-studysnap', 'root');
    shadow = shadowHost.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = STYLES;
    shadow.appendChild(style);

    highlightEl = document.createElement('div');
    highlightEl.className = 'ss-highlight';
    highlightEl.style.display = 'none';
    shadow.appendChild(highlightEl);

    tagEl = document.createElement('div');
    tagEl.className = 'ss-tag';
    tagEl.style.display = 'none';
    shadow.appendChild(tagEl);

    document.documentElement.appendChild(shadowHost);
  }

  function destroyShadowDOM() {
    if (shadowHost && shadowHost.parentNode) {
      shadowHost.parentNode.removeChild(shadowHost);
    }
    shadowHost = null;
    shadow = null;
    highlightEl = null;
    tagEl = null;
  }

  function getElementDescriptor(el) {
    let desc = el.tagName.toLowerCase();
    if (el.id) desc += `#${el.id}`;
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\s+/).slice(0, 2).join('.');
      if (classes) desc += `.${classes}`;
    }
    return desc;
  }

  function isOurElement(el) {
    if (!el) return false;
    let node = el;
    while (node) {
      if (node === shadowHost) return true;
      if (node.getAttribute && node.getAttribute('data-studysnap')) return true;
      node = node.parentNode;
    }
    return false;
  }

  function updateHighlight(el) {
    if (!el || !highlightEl) return;
    const rect = el.getBoundingClientRect();
    highlightEl.style.display = 'block';
    highlightEl.style.top = rect.top + 'px';
    highlightEl.style.left = rect.left + 'px';
    highlightEl.style.width = rect.width + 'px';
    highlightEl.style.height = rect.height + 'px';

    tagEl.style.display = 'block';
    tagEl.textContent = getElementDescriptor(el);
    tagEl.style.left = rect.left + 'px';
    tagEl.style.top = Math.max(0, rect.top - 22) + 'px';
  }

  function hideHighlight() {
    if (highlightEl) highlightEl.style.display = 'none';
    if (tagEl) tagEl.style.display = 'none';
  }

  // --- Event Handlers ---

  function onMouseMove(e) {
    if (selectedElement) return; // Locked on selection
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isOurElement(el)) {
      if (!currentElement) hideHighlight();
      return;
    }
    if (el === currentElement) return;
    currentElement = el;
    updateHighlight(el);
  }

  function onMouseOut(e) {
    if (selectedElement) return;
    if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
      currentElement = null;
      hideHighlight();
    }
  }

  function onClick(e) {
    if (selectedElement) return;
    if (!currentElement || isOurElement(e.target)) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    selectedElement = currentElement;
    highlightEl.classList.add('selected');
    showActionPanel();
  }

  function onWheel(e) {
    if (selectedElement) return;
    if (!currentElement) return;

    e.preventDefault();
    e.stopPropagation();

    if (e.deltaY < 0 && currentElement.parentElement &&
        currentElement.parentElement !== document.documentElement &&
        currentElement.parentElement !== document.body) {
      // Scroll up → parent
      currentElement = currentElement.parentElement;
    } else if (e.deltaY > 0 && currentElement.children.length > 0) {
      // Scroll down → first child element
      const firstChild = Array.from(currentElement.children).find(
        c => c.nodeType === 1 && !isOurElement(c)
      );
      if (firstChild) currentElement = firstChild;
    }
    updateHighlight(currentElement);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (selectedElement) {
        cancelSelection();
      } else {
        deactivate();
      }
    }
  }

  // --- Action Panel ---

  let actionPanelEl = null;

  function showActionPanel() {
    if (!shadow || !selectedElement) return;

    actionPanelEl = document.createElement('div');
    actionPanelEl.className = 'ss-action-panel';

    const rect = selectedElement.getBoundingClientRect();
    let panelLeft = rect.right + 12;
    let panelTop = rect.top;

    // Viewport bounds check
    if (panelLeft + 280 > window.innerWidth) {
      panelLeft = rect.left - 280 - 12;
    }
    if (panelLeft < 8) panelLeft = 8;
    if (panelTop + 320 > window.innerHeight) {
      panelTop = window.innerHeight - 320;
    }
    if (panelTop < 8) panelTop = 8;

    actionPanelEl.style.left = panelLeft + 'px';
    actionPanelEl.style.top = panelTop + 'px';

    const actions = [
      { id: 'notes', icon: '\u{1F4DD}', label: 'Notes' },
      { id: 'study-guide', icon: '\u{1F4D6}', label: 'Study Guide' },
      { id: 'flashcards', icon: '\u{1F5C2}', label: 'Flashcards' },
      { id: 'summary', icon: '\u{1F4CB}', label: 'Summary' },
      { id: 'practice-quiz', icon: '\u2705', label: 'Practice Quiz' },
      { id: 'key-terms', icon: '\u{1F511}', label: 'Key Terms' }
    ];

    actionPanelEl.innerHTML = `
      <h3>What would you like to create?</h3>
      <div class="ss-actions-grid">
        ${actions.map(a => `
          <button class="ss-action-btn" data-action="${a.id}">
            <span class="ss-icon">${a.icon}</span>
            <span class="ss-label">${a.label}</span>
          </button>
        `).join('')}
      </div>
      <button class="ss-cancel-btn">Cancel (Esc)</button>
    `;

    actionPanelEl.querySelectorAll('.ss-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = btn.dataset.action;
        handleActionSelected(action);
      });
    });

    actionPanelEl.querySelector('.ss-cancel-btn').addEventListener('click', cancelSelection);

    shadow.appendChild(actionPanelEl);
  }

  function hideActionPanel() {
    if (actionPanelEl && actionPanelEl.parentNode) {
      actionPanelEl.parentNode.removeChild(actionPanelEl);
    }
    actionPanelEl = null;
  }

  function cancelSelection() {
    selectedElement = null;
    if (highlightEl) highlightEl.classList.remove('selected');
    hideHighlight();
    hideActionPanel();
  }

  function handleActionSelected(action) {
    if (!selectedElement) return;

    const html = selectedElement.outerHTML;
    const pageUrl = window.location.href;
    const pageTitle = document.title;

    // Clean HTML before sending
    let cleanedHtml = html;
    if (typeof window.__studySnapProcessHTML === 'function') {
      cleanedHtml = window.__studySnapProcessHTML(html);
    }

    chrome.runtime.sendMessage({
      type: 'transform-content',
      html: cleanedHtml,
      action: action,
      pageUrl: pageUrl,
      pageTitle: pageTitle
    });

    // Deactivate inspector after sending
    deactivate();
  }

  // --- Lifecycle ---

  function activate() {
    isActive = true;
    createShadowDOM();
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('wheel', onWheel, { capture: true, passive: false });
    document.addEventListener('keydown', onKeyDown, true);
  }

  function deactivate() {
    isActive = false;
    currentElement = null;
    selectedElement = null;
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('wheel', onWheel, true);
    document.removeEventListener('keydown', onKeyDown, true);
    hideActionPanel();
    destroyShadowDOM();
    chrome.runtime.sendMessage({ type: 'inspector-deactivated' });
  }

  window.__studySnapToggle = () => {
    if (isActive) deactivate();
    else activate();
  };

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'toggle-inspector') {
      window.__studySnapToggle();
      sendResponse({ active: isActive });
    }
  });

  activate();
})();
```

**Step 2: Verify — load extension, click icon on any page, hover elements to see blue highlight + tag label; click to select and see action panel; press Escape to cancel; click icon again to toggle off**

**Step 3: Commit**

```bash
git add content/inspector.js
git commit -m "feat: inspector with hover highlight, selection, action panel"
```

---

### Task 4: HTML Processing Utilities

**Files:**
- Create: `lib/utils.js`

**Step 1: Write the HTML processing and content detection utilities**

```js
// lib/utils.js

// --- HTML Processing ---

function __studySnapProcessHTML(rawHTML) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHTML, 'text/html');

  // Remove noise elements
  const removeSelectors = [
    'script', 'style', 'noscript', 'iframe',
    '[aria-hidden="true"]', '.ad', '.advertisement', '.ads',
    '.cookie-banner', '.cookie-notice'
  ];
  removeSelectors.forEach(sel => {
    doc.querySelectorAll(sel).forEach(el => el.remove());
  });

  // Attributes to preserve (important for quiz content)
  const preserveAttrs = new Set([
    'class', 'data-correct', 'data-answer', 'data-score',
    'data-value', 'data-index', 'aria-label', 'title',
    'style', 'type', 'checked', 'disabled', 'href', 'src', 'alt'
  ]);

  // Strip unnecessary attributes
  doc.querySelectorAll('*').forEach(el => {
    const attrs = [...el.attributes];
    attrs.forEach(attr => {
      if (!preserveAttrs.has(attr.name) && !attr.name.startsWith('data-')) {
        el.removeAttribute(attr.name);
      }
    });
  });

  let cleaned = doc.body.innerHTML;

  // Collapse excessive whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  // Size check
  if (cleaned.length > 50000) {
    cleaned = __studySnapTruncate(cleaned, 50000);
  }

  return cleaned;
}

function __studySnapTruncate(html, maxLen) {
  if (html.length <= maxLen) return html;

  // Try to cut at a closing tag boundary
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

  // Escape HTML entities in the source
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`;
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
    const ths = header.split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
    const rows = body.trim().split('\n').map(row => {
      const tds = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    return `<table><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // Unordered lists
  html = html.replace(/^(\s*)[-*]\s+(.+)$/gm, (_, indent, text) => {
    const depth = Math.floor(indent.length / 2);
    return `<li data-depth="${depth}">${text}</li>`;
  });

  // Ordered lists
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<oli>$1</oli>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Wrap consecutive <oli> in <ol>
  html = html.replace(/((?:<oli>.*<\/oli>\n?)+)/g, (match) => {
    return '<ol>' + match.replace(/<\/?oli>/g, (t) => t.replace('oli', 'li')) + '</ol>';
  });

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  // Paragraphs — wrap remaining bare lines
  html = html.replace(/^(?!<[a-z/])((?!^\s*$).+)$/gm, '<p>$1</p>');

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');

  return html;
}

// Export for side panel if in extension context
if (typeof window !== 'undefined') {
  window.__studySnapProcessHTML = __studySnapProcessHTML;
  window.__studySnapDetectContentType = __studySnapDetectContentType;
  window.__studySnapParseMarkdown = __studySnapParseMarkdown;
  window.__studySnapTruncate = __studySnapTruncate;
}
```

**Step 2: Update service worker to inject utils.js before inspector.js**

In `background/service-worker.js`, update the injection in the catch block:

```js
    // Not injected yet — inject now
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/utils.js', 'content/inspector.js']
    });
```

**Step 3: Verify — reload extension, select an element, check console for no errors**

**Step 4: Commit**

```bash
git add lib/utils.js background/service-worker.js
git commit -m "feat: HTML processing, content detection, and markdown parser utilities"
```

---

### Task 5: Service Worker — Claude API Integration

**Files:**
- Modify: `background/service-worker.js` (full rewrite)

**Step 1: Write the complete service worker with API integration and streaming**

```js
// background/service-worker.js

let sidePanelPort = null;

// --- Side Panel Connection ---

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'sidepanel') {
    sidePanelPort = port;
    port.onDisconnect.addListener(() => {
      sidePanelPort = null;
    });
  }
});

// --- Inspector Injection ---

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'toggle-inspector' });
  } catch (e) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/utils.js', 'content/inspector.js']
    });
  }
});

// --- Message Handling ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'transform-content') {
    handleTransformRequest(message, sender.tab);
  }
  if (message.type === 'inspector-deactivated') {
    // No-op, tracked for potential future use
  }
});

// --- Claude API ---

const SYSTEM_PROMPTS = {
  notes: `You are an expert educator creating study notes. Analyze the HTML content and:
1. Extract key information and organize into clear, hierarchical notes
2. Use bullet points and sub-points for structure
3. Highlight key terms in bold
4. If content contains quiz/test results, identify correct answers (look for classes like "correct", "incorrect", checkmarks, green/red styling) and explain them
Format output as clean Markdown.`,

  'study-guide': `You are an expert educator creating a comprehensive study guide. Analyze the HTML content and:
1. Identify main topics and subtopics
2. Explain each concept clearly
3. Highlight key takeaways per section
4. Include review questions at the end
5. If content is quiz results, reconstruct as a study guide with explanations for correct answers
Pay attention to HTML classes like "correct", "incorrect", "selected", "right-answer", checkmarks, and color styling indicating answer correctness.
Format output as clean Markdown.`,

  flashcards: `You are creating flashcards from webpage content. For each concept, fact, or Q&A pair:
- Create a FRONT (question/prompt) and BACK (answer/explanation)
- Keep fronts concise and specific
- Make backs complete but not verbose
- If content is quiz results, turn each question into a flashcard
- Generate 5-20 flashcards depending on content density
IMPORTANT: Return ONLY a valid JSON array, no markdown code fences:
[{"front": "...", "back": "..."}, ...]`,

  summary: `You are creating a concise summary of webpage content:
1. Identify the most important points
2. Condense to essential information
3. Maintain logical flow, 3-5 paragraphs max
4. If quiz results, summarize key topics tested and areas to review
Format output as clean Markdown.`,

  'practice-quiz': `You are creating a practice quiz from webpage content. Generate 5-15 multiple choice questions.
IMPORTANT: Return ONLY valid JSON, no markdown code fences:
{
  "questions": [
    {
      "question": "Question text here?",
      "options": ["A) First option", "B) Second option", "C) Third option", "D) Fourth option"],
      "correct": 0,
      "explanation": "Brief explanation of why this answer is correct."
    }
  ]
}
If source content IS a quiz, recreate as a fresh practice version with shuffled options.`,

  'key-terms': `You are extracting key terms and definitions from webpage content. For each important term:
- Provide the term
- Provide a clear, concise definition
- Generate 5-25 terms depending on content density
IMPORTANT: Return ONLY valid JSON, no markdown code fences:
[{"term": "...", "definition": "..."}, ...]`
};

async function handleTransformRequest(message, tab) {
  const { html, action, pageUrl, pageTitle } = message;

  // Open side panel
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (e) {
    console.error('Failed to open side panel:', e);
    return;
  }

  // Wait briefly for panel to connect
  await new Promise(r => setTimeout(r, 600));

  sendToPanel({ type: 'transform-start', action });

  // Get API key
  const { anthropic_api_key } = await chrome.storage.sync.get('anthropic_api_key');
  if (!anthropic_api_key) {
    sendToPanel({
      type: 'transform-error',
      error: 'No API key set. Open settings in the panel to add your Anthropic API key.'
    });
    return;
  }

  const systemPrompt = SYSTEM_PROMPTS[action] || SYSTEM_PROMPTS.notes;
  const userMessage = `Here is HTML content from the webpage "${pageTitle}" (${pageUrl}):\n\n${html}\n\nPlease transform this content as requested.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropic_api_key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        stream: true
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      sendToPanel({ type: 'transform-error', error: `API error (${response.status}): ${errText}` });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') continue;
          try {
            const data = JSON.parse(dataStr);
            if (data.type === 'content_block_delta' && data.delta?.text) {
              sendToPanel({ type: 'stream-delta', text: data.delta.text });
            }
          } catch (e) {
            // Non-JSON SSE line, skip
          }
        }
      }
    }

    sendToPanel({ type: 'stream-complete' });

    // Update usage counter
    const { usage_today = 0, usage_date = '' } = await chrome.storage.local.get(['usage_today', 'usage_date']);
    const today = new Date().toISOString().split('T')[0];
    await chrome.storage.local.set({
      usage_today: usage_date === today ? usage_today + 1 : 1,
      usage_date: today
    });

  } catch (error) {
    sendToPanel({ type: 'transform-error', error: error.message });
  }
}

function sendToPanel(msg) {
  if (sidePanelPort) {
    try {
      sidePanelPort.postMessage(msg);
    } catch (e) {
      // Port disconnected
      sidePanelPort = null;
    }
  }
}
```

**Step 2: Verify — reload extension, check service worker console for no errors**

**Step 3: Commit**

```bash
git add background/service-worker.js
git commit -m "feat: Claude API integration with SSE streaming in service worker"
```

---

### Task 6: Side Panel — HTML Structure + Settings + Styles

**Files:**
- Modify: `sidepanel/sidepanel.html`
- Create: `sidepanel/sidepanel.css`
- Create: `sidepanel/sidepanel.js`

**Step 1: Write sidepanel.html**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>StudySnap</title>
  <link rel="stylesheet" href="sidepanel.css">
</head>
<body>
  <!-- Header -->
  <header class="sp-header">
    <div class="sp-logo">
      <span class="sp-logo-icon">&#x1F4DA;</span>
      <span class="sp-logo-text">StudySnap</span>
    </div>
    <button class="sp-settings-toggle" id="settingsToggle" title="Settings">
      &#x2699;&#xFE0F;
    </button>
  </header>

  <!-- Settings Panel (collapsible) -->
  <div class="sp-settings" id="settingsPanel" style="display:none;">
    <div class="sp-setting-row">
      <label for="apiKeyInput">Anthropic API Key</label>
      <div class="sp-key-input-wrap">
        <input type="password" id="apiKeyInput" placeholder="sk-ant-..." />
        <button class="sp-key-toggle" id="keyToggle">&#x1F441;</button>
      </div>
    </div>
    <div class="sp-setting-row">
      <label for="defaultAction">Default Action</label>
      <select id="defaultAction">
        <option value="notes">Notes</option>
        <option value="study-guide" selected>Study Guide</option>
        <option value="flashcards">Flashcards</option>
        <option value="summary">Summary</option>
        <option value="practice-quiz">Practice Quiz</option>
        <option value="key-terms">Key Terms</option>
      </select>
    </div>
    <div class="sp-setting-row">
      <button class="sp-save-btn" id="saveSettings">Save Settings</button>
    </div>
    <div class="sp-usage" id="usageInfo"></div>
  </div>

  <!-- Main Content -->
  <main class="sp-main" id="mainContent">
    <!-- Empty State -->
    <div class="sp-empty" id="emptyState">
      <div class="sp-empty-icon">&#x1F50D;</div>
      <h2>Select Content to Study</h2>
      <p>Click the StudySnap icon in your toolbar, then click any element on the page to transform it into study materials.</p>
    </div>

    <!-- Loading State -->
    <div class="sp-loading" id="loadingState" style="display:none;">
      <div class="sp-spinner"></div>
      <p id="loadingText">Generating study materials...</p>
    </div>

    <!-- Error State -->
    <div class="sp-error" id="errorState" style="display:none;">
      <div class="sp-error-icon">&#x26A0;&#xFE0F;</div>
      <p id="errorText"></p>
      <button class="sp-retry-btn" id="retryBtn">Try Again</button>
    </div>

    <!-- Results Area -->
    <div class="sp-results" id="resultsArea" style="display:none;">
      <!-- Toolbar -->
      <div class="sp-toolbar">
        <span class="sp-result-type" id="resultType"></span>
        <div class="sp-toolbar-actions">
          <button class="sp-tool-btn" id="copyBtn" title="Copy to clipboard">&#x1F4CB;</button>
          <button class="sp-tool-btn" id="downloadBtn" title="Download as Markdown">&#x2B07;&#xFE0F;</button>
          <button class="sp-tool-btn" id="regenerateBtn" title="Regenerate">&#x1F504;</button>
        </div>
      </div>

      <!-- Markdown Content (Notes, Study Guide, Summary) -->
      <div class="sp-markdown-content" id="markdownContent" style="display:none;"></div>

      <!-- Flashcards -->
      <div class="sp-flashcards" id="flashcardsContent" style="display:none;">
        <div class="sp-flashcard-container">
          <div class="sp-flashcard" id="flashcard">
            <div class="sp-flashcard-inner" id="flashcardInner">
              <div class="sp-flashcard-front" id="flashcardFront"></div>
              <div class="sp-flashcard-back" id="flashcardBack"></div>
            </div>
          </div>
          <p class="sp-flashcard-hint">Click card to flip</p>
        </div>
        <div class="sp-flashcard-nav">
          <button class="sp-nav-btn" id="prevCard">&#x2190; Prev</button>
          <span class="sp-card-counter" id="cardCounter">1 / 1</span>
          <button class="sp-nav-btn" id="nextCard">Next &#x2192;</button>
        </div>
      </div>

      <!-- Practice Quiz -->
      <div class="sp-quiz" id="quizContent" style="display:none;">
        <div id="quizQuestions"></div>
        <div class="sp-quiz-controls">
          <button class="sp-quiz-submit" id="quizSubmit">Check Answers</button>
          <div class="sp-quiz-score" id="quizScore" style="display:none;"></div>
        </div>
      </div>

      <!-- Key Terms -->
      <div class="sp-key-terms" id="keyTermsContent" style="display:none;">
        <div id="termsList"></div>
      </div>
    </div>
  </main>

  <script src="../lib/utils.js"></script>
  <script src="sidepanel.js"></script>
</body>
</html>
```

**Step 2: Write sidepanel.css**

```css
/* sidepanel/sidepanel.css */

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #1e293b;
  background: #ffffff;
  line-height: 1.5;
  overflow-x: hidden;
}

/* Header */
.sp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}

.sp-logo {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 16px;
}

.sp-logo-icon { font-size: 20px; }

.sp-settings-toggle {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  line-height: 1;
}
.sp-settings-toggle:hover { background: #e2e8f0; }

/* Settings */
.sp-settings {
  padding: 16px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}

.sp-setting-row {
  margin-bottom: 12px;
}

.sp-setting-row label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.sp-key-input-wrap {
  display: flex;
  gap: 4px;
}

.sp-key-input-wrap input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 13px;
  font-family: monospace;
}

.sp-key-toggle {
  background: none;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  cursor: pointer;
  padding: 0 8px;
  font-size: 14px;
}

.sp-settings select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 13px;
  background: white;
}

.sp-save-btn {
  width: 100%;
  padding: 8px;
  background: #3B82F6;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.sp-save-btn:hover { background: #2563EB; }

.sp-usage {
  margin-top: 8px;
  font-size: 12px;
  color: #94a3b8;
}

/* Main Content */
.sp-main {
  padding: 16px;
  min-height: calc(100vh - 60px);
}

/* Empty State */
.sp-empty {
  text-align: center;
  padding: 40px 20px;
  color: #94a3b8;
}
.sp-empty-icon { font-size: 48px; margin-bottom: 12px; }
.sp-empty h2 { font-size: 18px; color: #64748b; margin-bottom: 8px; }
.sp-empty p { font-size: 13px; line-height: 1.6; }

/* Loading */
.sp-loading {
  text-align: center;
  padding: 40px 20px;
}

.sp-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e2e8f0;
  border-top-color: #3B82F6;
  border-radius: 50%;
  animation: sp-spin 0.8s linear infinite;
  margin: 0 auto 12px;
}
@keyframes sp-spin { to { transform: rotate(360deg); } }

.sp-loading p { color: #64748b; font-size: 13px; }

/* Error */
.sp-error {
  text-align: center;
  padding: 40px 20px;
}
.sp-error-icon { font-size: 36px; margin-bottom: 8px; }
.sp-error p { color: #ef4444; margin-bottom: 12px; font-size: 13px; }

.sp-retry-btn {
  padding: 8px 16px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

/* Results Toolbar */
.sp-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  margin-bottom: 12px;
  border-bottom: 1px solid #e2e8f0;
}

.sp-result-type {
  font-size: 12px;
  font-weight: 600;
  color: #3B82F6;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.sp-toolbar-actions {
  display: flex;
  gap: 4px;
}

.sp-tool-btn {
  background: none;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}
.sp-tool-btn:hover { background: #f1f5f9; }

/* Markdown Content */
.sp-markdown-content {
  line-height: 1.7;
}

.sp-markdown-content h1 { font-size: 22px; margin: 20px 0 10px; color: #0f172a; }
.sp-markdown-content h2 { font-size: 18px; margin: 18px 0 8px; color: #1e293b; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
.sp-markdown-content h3 { font-size: 16px; margin: 14px 0 6px; color: #334155; }
.sp-markdown-content h4 { font-size: 14px; margin: 12px 0 4px; color: #475569; }
.sp-markdown-content p { margin: 8px 0; }
.sp-markdown-content strong { color: #0f172a; }
.sp-markdown-content ul, .sp-markdown-content ol { padding-left: 24px; margin: 8px 0; }
.sp-markdown-content li { margin: 4px 0; }
.sp-markdown-content code {
  background: #f1f5f9;
  padding: 2px 5px;
  border-radius: 3px;
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.sp-markdown-content pre {
  background: #1e293b;
  color: #e2e8f0;
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 12px 0;
}
.sp-markdown-content pre code {
  background: none;
  padding: 0;
  color: inherit;
}
.sp-markdown-content table {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 13px;
}
.sp-markdown-content th, .sp-markdown-content td {
  border: 1px solid #e2e8f0;
  padding: 8px;
  text-align: left;
}
.sp-markdown-content th { background: #f8fafc; font-weight: 600; }
.sp-markdown-content hr { border: none; border-top: 1px solid #e2e8f0; margin: 16px 0; }
.sp-markdown-content a { color: #3B82F6; text-decoration: none; }
.sp-markdown-content a:hover { text-decoration: underline; }

/* Flashcards */
.sp-flashcards { padding: 8px 0; }

.sp-flashcard-container {
  perspective: 1000px;
  text-align: center;
  margin-bottom: 16px;
}

.sp-flashcard {
  width: 100%;
  height: 200px;
  cursor: pointer;
}

.sp-flashcard-inner {
  position: relative;
  width: 100%;
  height: 100%;
  transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  transform-style: preserve-3d;
}

.sp-flashcard.flipped .sp-flashcard-inner {
  transform: rotateY(180deg);
}

.sp-flashcard-front, .sp-flashcard-back {
  position: absolute;
  width: 100%;
  height: 100%;
  backface-visibility: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  border-radius: 12px;
  font-size: 15px;
  text-align: center;
  overflow-y: auto;
}

.sp-flashcard-front {
  background: linear-gradient(135deg, #eff6ff, #dbeafe);
  border: 1px solid #bfdbfe;
  color: #1e40af;
  font-weight: 600;
}

.sp-flashcard-back {
  background: linear-gradient(135deg, #f0fdf4, #dcfce7);
  border: 1px solid #bbf7d0;
  color: #166534;
  transform: rotateY(180deg);
}

.sp-flashcard-hint {
  font-size: 12px;
  color: #94a3b8;
  margin-top: 8px;
}

.sp-flashcard-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.sp-nav-btn {
  padding: 6px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: white;
  cursor: pointer;
  font-size: 13px;
}
.sp-nav-btn:hover { background: #f1f5f9; }
.sp-nav-btn:disabled { opacity: 0.4; cursor: default; }

.sp-card-counter {
  font-size: 13px;
  color: #64748b;
  font-weight: 600;
}

/* Practice Quiz */
.sp-quiz { padding: 8px 0; }

.sp-quiz-question {
  margin-bottom: 20px;
  padding: 16px;
  background: #f8fafc;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.sp-quiz-question h4 {
  font-size: 14px;
  margin-bottom: 10px;
  color: #1e293b;
}

.sp-quiz-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  margin: 4px 0;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.sp-quiz-option:hover { background: #eff6ff; }
.sp-quiz-option.selected { background: #dbeafe; border: 1px solid #93c5fd; }
.sp-quiz-option.correct { background: #dcfce7; border: 1px solid #86efac; }
.sp-quiz-option.incorrect { background: #fef2f2; border: 1px solid #fca5a5; }

.sp-quiz-option input[type="radio"] { margin-top: 2px; }

.sp-quiz-explanation {
  margin-top: 8px;
  padding: 8px 12px;
  background: #f0fdf4;
  border-radius: 6px;
  font-size: 12px;
  color: #166534;
  display: none;
}

.sp-quiz-controls {
  text-align: center;
  padding: 12px 0;
}

.sp-quiz-submit {
  padding: 10px 24px;
  background: #3B82F6;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.sp-quiz-submit:hover { background: #2563EB; }

.sp-quiz-score {
  margin-top: 12px;
  font-size: 18px;
  font-weight: 700;
  color: #1e293b;
}

/* Key Terms */
.sp-key-terms { padding: 8px 0; }

.sp-term-card {
  padding: 12px 16px;
  margin-bottom: 8px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  border-left: 3px solid #3B82F6;
}

.sp-term-card .sp-term {
  font-weight: 700;
  color: #1e40af;
  font-size: 14px;
  margin-bottom: 4px;
}

.sp-term-card .sp-definition {
  font-size: 13px;
  color: #475569;
  line-height: 1.5;
}

/* Streaming cursor */
.sp-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: #3B82F6;
  animation: sp-blink 0.8s step-end infinite;
  vertical-align: text-bottom;
  margin-left: 1px;
}
@keyframes sp-blink { 50% { opacity: 0; } }
```

**Step 3: Write sidepanel.js**

```js
// sidepanel/sidepanel.js

// --- State ---
let currentAction = null;
let rawText = '';
let flashcards = [];
let currentCardIndex = 0;
let quizData = null;
let lastTransformRequest = null;

// --- Port Connection ---
const port = chrome.runtime.connect({ name: 'sidepanel' });

port.onMessage.addListener((msg) => {
  switch (msg.type) {
    case 'transform-start':
      onTransformStart(msg.action);
      break;
    case 'stream-delta':
      onStreamDelta(msg.text);
      break;
    case 'stream-complete':
      onStreamComplete();
      break;
    case 'transform-error':
      onTransformError(msg.error);
      break;
  }
});

// --- UI References ---
const $ = (id) => document.getElementById(id);

const emptyState = $('emptyState');
const loadingState = $('loadingState');
const errorState = $('errorState');
const resultsArea = $('resultsArea');
const markdownContent = $('markdownContent');
const flashcardsContent = $('flashcardsContent');
const quizContent = $('quizContent');
const keyTermsContent = $('keyTermsContent');
const resultType = $('resultType');
const loadingText = $('loadingText');
const errorText = $('errorText');

function showView(view) {
  [emptyState, loadingState, errorState, resultsArea].forEach(el => el.style.display = 'none');
  view.style.display = '';
}

function showResultView(view) {
  [markdownContent, flashcardsContent, quizContent, keyTermsContent].forEach(el => el.style.display = 'none');
  view.style.display = '';
}

// --- Transform Handlers ---

const ACTION_LABELS = {
  'notes': 'Notes',
  'study-guide': 'Study Guide',
  'flashcards': 'Flashcards',
  'summary': 'Summary',
  'practice-quiz': 'Practice Quiz',
  'key-terms': 'Key Terms'
};

function onTransformStart(action) {
  currentAction = action;
  rawText = '';
  flashcards = [];
  currentCardIndex = 0;
  quizData = null;

  const label = ACTION_LABELS[action] || action;
  loadingText.textContent = `Generating ${label.toLowerCase()}...`;
  showView(loadingState);
}

function onStreamDelta(text) {
  rawText += text;

  // For markdown-based actions, show progressive rendering
  if (['notes', 'study-guide', 'summary'].includes(currentAction)) {
    showView(resultsArea);
    resultType.textContent = ACTION_LABELS[currentAction];
    showResultView(markdownContent);

    const parsed = __studySnapParseMarkdown(rawText);
    markdownContent.innerHTML = parsed + '<span class="sp-cursor"></span>';
    markdownContent.scrollTop = markdownContent.scrollHeight;
  }
}

function onStreamComplete() {
  showView(resultsArea);
  resultType.textContent = ACTION_LABELS[currentAction];

  if (['notes', 'study-guide', 'summary'].includes(currentAction)) {
    showResultView(markdownContent);
    markdownContent.innerHTML = __studySnapParseMarkdown(rawText);
  } else if (currentAction === 'flashcards') {
    renderFlashcards();
  } else if (currentAction === 'practice-quiz') {
    renderQuiz();
  } else if (currentAction === 'key-terms') {
    renderKeyTerms();
  }
}

function onTransformError(error) {
  errorText.textContent = error;
  showView(errorState);
}

// --- Flashcards ---

function renderFlashcards() {
  try {
    // Strip markdown code fences if present
    let json = rawText.trim();
    if (json.startsWith('```')) {
      json = json.replace(/^```\w*\n/, '').replace(/\n```$/, '');
    }
    flashcards = JSON.parse(json);
  } catch (e) {
    // Try to find JSON array in the text
    const match = rawText.match(/\[[\s\S]*\]/);
    if (match) {
      try { flashcards = JSON.parse(match[0]); }
      catch (e2) {
        onTransformError('Failed to parse flashcard data. Please try again.');
        return;
      }
    } else {
      onTransformError('Failed to parse flashcard data. Please try again.');
      return;
    }
  }

  if (flashcards.length === 0) {
    onTransformError('No flashcards generated. Try selecting more content.');
    return;
  }

  currentCardIndex = 0;
  showResultView(flashcardsContent);
  displayCard();
}

function displayCard() {
  const card = flashcards[currentCardIndex];
  $('flashcardFront').textContent = card.front;
  $('flashcardBack').textContent = card.back;
  $('flashcard').classList.remove('flipped');
  $('cardCounter').textContent = `${currentCardIndex + 1} / ${flashcards.length}`;
  $('prevCard').disabled = currentCardIndex === 0;
  $('nextCard').disabled = currentCardIndex === flashcards.length - 1;
}

$('flashcard').addEventListener('click', () => {
  $('flashcard').classList.toggle('flipped');
});

$('prevCard').addEventListener('click', () => {
  if (currentCardIndex > 0) {
    currentCardIndex--;
    displayCard();
  }
});

$('nextCard').addEventListener('click', () => {
  if (currentCardIndex < flashcards.length - 1) {
    currentCardIndex++;
    displayCard();
  }
});

// Keyboard navigation for flashcards
document.addEventListener('keydown', (e) => {
  if (flashcardsContent.style.display === 'none') return;
  if (e.key === 'ArrowLeft') $('prevCard').click();
  if (e.key === 'ArrowRight') $('nextCard').click();
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    $('flashcard').click();
  }
});

// --- Practice Quiz ---

function renderQuiz() {
  try {
    let json = rawText.trim();
    if (json.startsWith('```')) {
      json = json.replace(/^```\w*\n/, '').replace(/\n```$/, '');
    }
    quizData = JSON.parse(json);
  } catch (e) {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) {
      try { quizData = JSON.parse(match[0]); }
      catch (e2) {
        onTransformError('Failed to parse quiz data. Please try again.');
        return;
      }
    } else {
      onTransformError('Failed to parse quiz data. Please try again.');
      return;
    }
  }

  const questions = quizData.questions || [];
  if (questions.length === 0) {
    onTransformError('No quiz questions generated. Try selecting more content.');
    return;
  }

  showResultView(quizContent);
  const container = $('quizQuestions');
  container.innerHTML = '';
  $('quizScore').style.display = 'none';
  $('quizSubmit').style.display = '';

  questions.forEach((q, qi) => {
    const div = document.createElement('div');
    div.className = 'sp-quiz-question';
    div.innerHTML = `
      <h4>Q${qi + 1}. ${escapeHtml(q.question)}</h4>
      ${q.options.map((opt, oi) => `
        <label class="sp-quiz-option" data-qi="${qi}" data-oi="${oi}">
          <input type="radio" name="q${qi}" value="${oi}">
          <span>${escapeHtml(opt)}</span>
        </label>
      `).join('')}
      <div class="sp-quiz-explanation" id="explanation-${qi}">${escapeHtml(q.explanation || '')}</div>
    `;
    container.appendChild(div);
  });
}

$('quizSubmit').addEventListener('click', () => {
  if (!quizData) return;
  const questions = quizData.questions;
  let score = 0;

  questions.forEach((q, qi) => {
    const selected = document.querySelector(`input[name="q${qi}"]:checked`);
    const selectedIdx = selected ? parseInt(selected.value) : -1;
    const correctIdx = q.correct;

    document.querySelectorAll(`[data-qi="${qi}"]`).forEach(opt => {
      const oi = parseInt(opt.dataset.oi);
      opt.classList.remove('selected', 'correct', 'incorrect');
      if (oi === correctIdx) opt.classList.add('correct');
      if (oi === selectedIdx && selectedIdx !== correctIdx) opt.classList.add('incorrect');
    });

    $(`explanation-${qi}`).style.display = 'block';
    if (selectedIdx === correctIdx) score++;
  });

  $('quizSubmit').style.display = 'none';
  const scoreEl = $('quizScore');
  scoreEl.style.display = 'block';
  scoreEl.textContent = `Score: ${score} / ${questions.length} (${Math.round(score / questions.length * 100)}%)`;
});

// --- Key Terms ---

function renderKeyTerms() {
  let terms;
  try {
    let json = rawText.trim();
    if (json.startsWith('```')) {
      json = json.replace(/^```\w*\n/, '').replace(/\n```$/, '');
    }
    terms = JSON.parse(json);
  } catch (e) {
    const match = rawText.match(/\[[\s\S]*\]/);
    if (match) {
      try { terms = JSON.parse(match[0]); }
      catch (e2) {
        onTransformError('Failed to parse key terms data. Please try again.');
        return;
      }
    } else {
      onTransformError('Failed to parse key terms data. Please try again.');
      return;
    }
  }

  if (!terms || terms.length === 0) {
    onTransformError('No key terms found. Try selecting more content.');
    return;
  }

  showResultView(keyTermsContent);
  const container = $('termsList');
  container.innerHTML = '';

  terms.forEach(t => {
    const card = document.createElement('div');
    card.className = 'sp-term-card';
    card.innerHTML = `
      <div class="sp-term">${escapeHtml(t.term)}</div>
      <div class="sp-definition">${escapeHtml(t.definition)}</div>
    `;
    container.appendChild(card);
  });
}

// --- Toolbar Actions ---

$('copyBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(rawText).then(() => {
    const btn = $('copyBtn');
    const orig = btn.textContent;
    btn.textContent = '\u2705';
    setTimeout(() => btn.textContent = orig, 1500);
  });
});

$('downloadBtn').addEventListener('click', () => {
  const blob = new Blob([rawText], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `studysnap-${currentAction}-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
});

$('regenerateBtn').addEventListener('click', () => {
  // Send message to service worker to redo last transform
  chrome.runtime.sendMessage({ type: 'regenerate' });
});

// --- Settings ---

$('settingsToggle').addEventListener('click', () => {
  const panel = $('settingsPanel');
  panel.style.display = panel.style.display === 'none' ? '' : 'none';
  if (panel.style.display !== 'none') loadSettings();
});

$('keyToggle').addEventListener('click', () => {
  const input = $('apiKeyInput');
  input.type = input.type === 'password' ? 'text' : 'password';
});

$('saveSettings').addEventListener('click', async () => {
  const apiKey = $('apiKeyInput').value.trim();
  const defaultAction = $('defaultAction').value;

  await chrome.storage.sync.set({
    anthropic_api_key: apiKey,
    default_action: defaultAction
  });

  const btn = $('saveSettings');
  btn.textContent = 'Saved!';
  setTimeout(() => btn.textContent = 'Save Settings', 1500);
});

async function loadSettings() {
  const { anthropic_api_key = '', default_action = 'study-guide' } = await chrome.storage.sync.get(['anthropic_api_key', 'default_action']);
  $('apiKeyInput').value = anthropic_api_key;
  $('defaultAction').value = default_action;

  const { usage_today = 0, usage_date = '' } = await chrome.storage.local.get(['usage_today', 'usage_date']);
  const today = new Date().toISOString().split('T')[0];
  if (usage_date === today) {
    $('usageInfo').textContent = `${usage_today} transformation${usage_today !== 1 ? 's' : ''} today`;
  } else {
    $('usageInfo').textContent = '0 transformations today';
  }
}

$('retryBtn').addEventListener('click', () => {
  showView(emptyState);
});

// --- Helpers ---

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
```

**Step 4: Verify — reload extension, open side panel manually (right-click icon → Open side panel), verify settings toggle works, save an API key**

**Step 5: Commit**

```bash
git add sidepanel/
git commit -m "feat: side panel with settings, flashcards, quiz, key terms UIs"
```

---

### Task 7: Integration and End-to-End Test

**Files:**
- No new files — verify full pipeline works

**Step 1: Set up for testing**

1. Load extension at `chrome://extensions`
2. Open the side panel and enter a valid Anthropic API key
3. Navigate to any content-rich webpage (Wikipedia article, news article, or a Quizlet page)

**Step 2: Test Notes flow**

1. Click the StudySnap icon
2. Hover over a content section — verify blue highlight appears
3. Use scroll wheel to adjust selection size
4. Click to select — verify action panel appears
5. Click "Notes" — verify:
   - Inspector deactivates
   - Side panel shows loading state
   - Text streams in progressively with blinking cursor
   - Final result is formatted Markdown

**Step 3: Test Flashcards flow**

1. Click icon again, select content, choose "Flashcards"
2. Verify flip-card UI appears
3. Click card to flip, use arrow buttons/keys to navigate

**Step 4: Test Practice Quiz flow**

1. Select content, choose "Practice Quiz"
2. Verify quiz renders with radio buttons
3. Select answers and click "Check Answers"
4. Verify correct/incorrect highlighting and score

**Step 5: Test Key Terms flow**

1. Select content, choose "Key Terms"
2. Verify glossary cards appear

**Step 6: Test toolbar actions**

1. Click copy button — verify clipboard has content
2. Click download button — verify .md file downloads

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: StudySnap v1.0 — complete Chrome extension"
```

---

### Task 8: Polish — Error Handling, Edge Cases, Keyboard Shortcuts

**Files:**
- Modify: `content/inspector.js` (add keyboard shortcut hint)
- Modify: `background/service-worker.js` (add regenerate handling, error recovery)
- Modify: `sidepanel/sidepanel.js` (improve error messages)

**Step 1: Add regenerate support to service worker**

Add to the message listener in `background/service-worker.js`:

```js
let lastRequest = null;

// In handleTransformRequest, save the request:
// lastRequest = { html, action, pageUrl, pageTitle, tabId: tab.id };

// In the message listener:
if (message.type === 'regenerate' && lastRequest) {
  handleTransformRequest(lastRequest, { id: lastRequest.tabId });
}
```

**Step 2: Add large selection warning to inspector.js**

In `handleActionSelected`, before sending:

```js
if (html.length > 100000) {
  if (!confirm('This is a large selection. Processing may take longer. Continue?')) {
    cancelSelection();
    return;
  }
}
```

**Step 3: Improve streaming error recovery in sidepanel.js**

Add a timeout — if no stream delta received in 30 seconds after start, show error:

```js
let streamTimeout = null;

function onTransformStart(action) {
  // ... existing code ...
  clearTimeout(streamTimeout);
  streamTimeout = setTimeout(() => {
    if (loadingState.style.display !== 'none') {
      onTransformError('Request timed out. Please try again.');
    }
  }, 30000);
}

function onStreamDelta(text) {
  clearTimeout(streamTimeout);
  streamTimeout = setTimeout(() => {
    onTransformError('Stream interrupted. Showing partial results.');
    onStreamComplete();
  }, 15000);
  // ... existing code ...
}

function onStreamComplete() {
  clearTimeout(streamTimeout);
  // ... existing code ...
}
```

**Step 4: Verify all error states**

1. Remove API key → try transform → verify "No API key" error
2. Enter invalid API key → try transform → verify API error message
3. Select tiny element (empty div) → verify Claude handles gracefully

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: error handling, regenerate support, streaming timeout"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Project scaffold | manifest.json, icons/, stubs |
| 2 | Service worker — injection | background/service-worker.js, content/inspector.js |
| 3 | Inspector — highlight + action panel | content/inspector.js |
| 4 | HTML processing utilities | lib/utils.js |
| 5 | Claude API integration | background/service-worker.js |
| 6 | Side panel — full UI | sidepanel/ |
| 7 | Integration testing | All files |
| 8 | Polish + error handling | Multiple files |

Total: 8 tasks, ~12 files, fully functional Chrome extension.
