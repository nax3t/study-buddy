# StudyBuddy

A Chrome extension that turns any webpage content into study materials using Claude AI.

## Features

- **Select any content** — Click elements or highlight text on any webpage
- **6 study formats** — Notes, study guide, flashcards, summary, practice quiz, key terms
- **Model selection** — Choose between Claude Haiku, Sonnet, or Opus
- **Live streaming** — Watch AI responses appear in real-time in the side panel
- **Export to .doc** — Download generated materials as Word documents
- **Copy to clipboard** — One-click copy for any generated content

## How It Works

1. Click the StudyBuddy icon to open the side panel and activate the content inspector
2. Hover over page content — elements highlight as you move your mouse
3. Click to select, then choose a study format from the action menu
4. Study materials stream into the side panel in real-time

### Selection Modes

- **Element mode** (default) — Click to select DOM elements. Use Alt+scroll to traverse parent/child elements.
- **Text mode** — Highlight text with click-and-drag to select specific passages.

Toggle between modes in the side panel settings.

## Setup

1. Clone the repo and load it as an unpacked extension in `chrome://extensions` (enable Developer mode)
2. Click the StudyBuddy icon and enter your [Anthropic API key](https://console.anthropic.com/) in settings
3. Navigate to any webpage and start selecting content

## Project Structure

```
background/     Service worker — API calls, streaming, system prompts
content/        Inspector script — page overlay, element/text selection
sidepanel/      Side panel UI — settings, results display, export
lib/            Shared utilities — HTML sanitization, markdown parsing
icons/          Extension icons
```
