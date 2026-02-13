// background/service-worker.js

let sidePanelPort = null;
let lastRequest = null;
let activeInspectorTabId = null;

// --- Side Panel Connection ---

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'sidepanel') {
    sidePanelPort = port;
    port.onDisconnect.addListener(() => {
      sidePanelPort = null;
      // Deactivate inspector when side panel is closed
      if (activeInspectorTabId !== null) {
        chrome.tabs.sendMessage(activeInspectorTabId, { type: 'deactivate-inspector' }).catch(() => {});
        activeInspectorTabId = null;
      }
    });
  }
});

// --- Inspector Injection ---

chrome.action.onClicked.addListener(async (tab) => {
  // Always open side panel so user can access settings / see status
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (e) {
    // Side panel may already be open
  }

  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
    return;
  }

  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'toggle-inspector' });
    activeInspectorTabId = resp?.active ? tab.id : null;
  } catch (e) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/utils.js', 'content/inspector.js'],
      world: 'ISOLATED'
    });
    activeInspectorTabId = tab.id;
  }
});

// --- Message Handling ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'transform-content') {
    handleTransformRequest(message, sender.tab);
  }
  if (message.type === 'regenerate' && lastRequest) {
    handleTransformRequest(lastRequest, { id: lastRequest.tabId });
  }
  if (message.type === 'inspector-deactivated') {
    activeInspectorTabId = null;
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
  lastRequest = { html: message.html, action: message.action, pageUrl: message.pageUrl, pageTitle: message.pageTitle, tabId: tab.id };
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
  const { anthropic_api_key } = await chrome.storage.local.get('anthropic_api_key');
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
      sidePanelPort = null;
    }
  }
}
