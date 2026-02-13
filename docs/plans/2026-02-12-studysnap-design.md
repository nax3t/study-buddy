# StudySnap Design Document

## Overview

StudySnap is a Chrome extension that lets users visually select any HTML element on a webpage (inspector-style), then sends that content to Claude to transform it into study materials: notes, study guides, flashcards, summaries, practice quizzes, and key terms.

## Core User Flow

1. User clicks extension icon in toolbar
2. Inspector overlay activates on the page
3. User hovers over elements — elements highlight with a bounding box + label
4. User clicks an element — selection is locked
5. A floating action panel appears near the selection
6. User picks a transformation type
7. Extension extracts the HTML, sends it to Claude API
8. Results are displayed in a slide-out side panel
9. User can copy, download, or regenerate the result

## Architecture

### File Structure

```
study-buddy/
├── manifest.json
├── background/
│   └── service-worker.js      # API calls to Claude, orchestration
├── content/
│   ├── inspector.js           # Inspector + action panel (merged)
│   └── inspector.css          # Overlay, highlight, panel styles
├── sidepanel/
│   ├── sidepanel.html
│   ├── sidepanel.js           # Rendering: markdown, flashcards, quiz
│   └── sidepanel.css
├── popup/
│   ├── popup.html             # Settings / API key entry
│   ├── popup.js
│   └── popup.css
├── icons/
│   ├── icon-16.svg
│   ├── icon-48.svg
│   └── icon-128.svg
└── lib/
    └── utils.js               # HTML cleaning, markdown parser
```

### Activation: On-Demand Injection

- No content_scripts in manifest — zero performance impact until activated
- `chrome.action.onClicked` in service worker triggers `chrome.scripting.executeScript()`
- Injects `inspector.js` + `inspector.css` into the active tab
- Only requires `activeTab` permission (no broad host_permissions)

### Message Flow

```
Content Script (inspector.js)    Service Worker              Anthropic API
     |                                |                           |
     |-- sendMessage(html, action) -> |                           |
     |                                |-- POST /v1/messages ----> |
     |                                |<-- streaming response --- |
     |<-- progressive updates ------- |                           |
```

## Component Details

### 1. Inspector System (content/inspector.js)

- All UI injected into a closed Shadow DOM for style isolation
- Hover: `document.elementFromPoint()` + absolute-positioned highlight div
- Smooth CSS transitions as highlight moves between elements
- Scroll-wheel: traverse DOM ancestors (up) / children (down)
- Click: freeze highlight, pulsing border, show action panel
- Escape: remove all injected DOM, cancel
- Action panel: 6 transformation options in a floating panel anchored to selection

### 2. Action Panel (inside inspector.js)

Options: Notes, Study Guide, Flashcards, Summary, Practice Quiz, Key Terms

Positioned relative to selected element with viewport-aware fallback positioning.

### 3. Service Worker (background/service-worker.js)

- Handles `chrome.action.onClicked` to inject content scripts
- Receives HTML + action from content script
- Cleans HTML via utils pipeline
- Calls Claude API with action-specific system prompts
- Streams response via SSE to side panel
- Model: claude-sonnet-4-5-20250929, max_tokens: 4096

### 4. HTML Processing Pipeline (lib/utils.js)

Before sending to Claude:
- Remove: scripts, styles, noscript, iframes, ads, nav, footer
- Preserve: classes (correct/incorrect/answer), data attributes, inline styles, aria-labels
- Strip unnecessary attributes
- Truncate if >50KB

Also includes: lightweight Markdown-to-HTML parser (headers, lists, bold/italic, code blocks, tables).

### 5. Side Panel (sidepanel/)

Format-specific rendering:
- Notes/Study Guide/Summary: Markdown -> HTML
- Flashcards: Interactive flip-card UI with CSS 3D transforms, arrow key navigation
- Practice Quiz: Radio buttons, submit/check, explanation reveal, score tracking
- Key Terms: Scrollable glossary cards

Actions toolbar: Copy to clipboard, Download as .md, Regenerate

Streaming: text appears progressively as Claude generates.

### 6. Settings Popup (popup/)

- API key input with show/hide toggle, stored in chrome.storage.sync
- Default action selector
- Usage counter (transformations today, stored in chrome.storage.local)

## Key Technical Decisions

1. **On-demand injection** over manifest content_scripts (performance, permissions)
2. **Closed Shadow DOM** for all injected UI (style isolation)
3. **Action panel merged into inspector.js** (shared state, simpler)
4. **Built-in Markdown parser** (no external dependencies)
5. **SVG icons** (no PNG generation needed)
6. **Download as Markdown** instead of PDF (no heavy library dependency)
7. **Streaming SSE** for progressive response display

## Security

- API key never exposed to content scripts; all API calls in service worker
- HTML sanitized before display in side panel
- activeTab permission only (not broad host access)
- Shadow DOM prevents host page access to extension UI
