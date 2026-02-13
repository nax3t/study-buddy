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
  let selectionMode = 'element';
  let textSelectionRange = null;

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

    .ss-toast {
      position: fixed;
      top: 48px;
      left: 50%;
      transform: translateX(-50%);
      background: #1e293b;
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      font-weight: 500;
      padding: 10px 20px;
      border-radius: 8px;
      z-index: 2147483647;
      pointer-events: none;
      animation: ss-toastIn 0.2s ease-out, ss-toastOut 0.3s ease-in 2s forwards;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }

    @keyframes ss-toastIn {
      from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    @keyframes ss-toastOut {
      from { opacity: 1; }
      to { opacity: 0; }
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
    if (el.id) desc += '#' + el.id;
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\s+/).slice(0, 2).join('.');
      if (classes) desc += '.' + classes;
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
    if (selectionMode !== 'element') return;
    if (selectedElement) return;
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
    if (selectionMode !== 'element') return;
    if (selectedElement) return;
    if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
      currentElement = null;
      hideHighlight();
    }
  }

  function onClick(e) {
    if (selectionMode !== 'element') return;
    if (selectedElement) return;
    if (!currentElement || isOurElement(e.target)) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    selectedElement = currentElement;
    highlightEl.classList.add('selected');
    showActionPanel(selectedElement.getBoundingClientRect());
  }

  function onMouseUp(e) {
    if (selectionMode !== 'text') return;
    if (selectedElement || textSelectionRange) return;
    // Small delay to let browser finalize selection
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.toString().trim() === '') return;
      textSelectionRange = sel.getRangeAt(0);
      showActionPanel(textSelectionRange.getBoundingClientRect());
    }, 10);
  }

  function onWheel(e) {
    if (selectionMode !== 'element') return;
    if (selectedElement) return;
    if (!currentElement) return;
    if (!e.altKey) return; // Only navigate DOM tree when Alt is held

    e.preventDefault();
    e.stopPropagation();

    if (e.deltaY < 0 && currentElement.parentElement &&
        currentElement.parentElement !== document.documentElement &&
        currentElement.parentElement !== document.body) {
      currentElement = currentElement.parentElement;
    } else if (e.deltaY > 0 && currentElement.children.length > 0) {
      const firstChild = Array.from(currentElement.children).find(
        c => c.nodeType === 1 && !isOurElement(c)
      );
      if (firstChild) currentElement = firstChild;
    }
    updateHighlight(currentElement);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (selectedElement || textSelectionRange) {
        cancelSelection();
      } else {
        deactivate();
      }
    }
  }

  // --- Action Panel ---

  let actionPanelEl = null;

  function showActionPanel(rect) {
    if (!shadow || (!selectedElement && !textSelectionRange)) return;

    actionPanelEl = document.createElement('div');
    actionPanelEl.className = 'ss-action-panel';

    let panelLeft = rect.right + 12;
    let panelTop = rect.top;

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
    if (selectionMode === 'text') {
      textSelectionRange = null;
      window.getSelection().removeAllRanges();
    } else {
      selectedElement = null;
      if (highlightEl) highlightEl.classList.remove('selected');
      hideHighlight();
    }
    hideActionPanel();
  }

  function handleActionSelected(action) {
    let html;

    if (selectionMode === 'text' && textSelectionRange) {
      const fragment = textSelectionRange.cloneContents();
      const tempDiv = document.createElement('div');
      tempDiv.appendChild(fragment);
      html = tempDiv.innerHTML;
      if (!html.trim()) return;
    } else if (selectedElement) {
      html = selectedElement.outerHTML;
    } else {
      return;
    }

    const pageUrl = window.location.href;
    const pageTitle = document.title;

    let cleanedHtml = html;
    if (typeof __studySnapProcessHTML === 'function') {
      cleanedHtml = __studySnapProcessHTML(html);
    }

    if (cleanedHtml.length > 100000) {
      if (!confirm('This is a large selection and may take longer to process. Continue?')) {
        cancelSelection();
        return;
      }
    }

    chrome.runtime.sendMessage({
      type: 'transform-content',
      html: cleanedHtml,
      action: action,
      pageUrl: pageUrl,
      pageTitle: pageTitle
    });

    deactivate();
  }

  // --- Mode Switching ---

  function setMode(mode, silent) {
    if (mode === selectionMode) return;
    cancelSelection();
    selectionMode = mode;
    if (mode === 'text') {
      hideHighlight();
      currentElement = null;
      if (!silent) showToast('Text mode: highlight text to select');
    } else {
      window.getSelection().removeAllRanges();
      textSelectionRange = null;
      if (!silent) showToast('Element mode: click to select');
    }
  }

  // --- Lifecycle ---

  function showToast(message) {
    if (!shadow) return;
    const toast = document.createElement('div');
    toast.className = 'ss-toast';
    toast.textContent = message;
    shadow.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 2500);
  }

  async function activate() {
    isActive = true;
    createShadowDOM();
    showToast('StudyBuddy active \u2014 Esc to exit');
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('wheel', onWheel, { capture: true, passive: false });
    document.addEventListener('keydown', onKeyDown, true);

    const { selection_mode = 'element' } = await chrome.storage.sync.get('selection_mode');
    setMode(selection_mode, true);
  }

  function deactivate() {
    isActive = false;
    selectionMode = 'element';
    currentElement = null;
    selectedElement = null;
    textSelectionRange = null;
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('mouseup', onMouseUp, true);
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
    if (msg.type === 'deactivate-inspector') {
      if (isActive) deactivate();
    }
    if (msg.type === 'set-selection-mode') {
      if (isActive) setMode(msg.mode);
    }
  });

  activate();
})();
