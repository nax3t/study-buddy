// sidepanel/sidepanel.js

// --- State ---
let currentAction = null;
let rawText = '';
let flashcards = [];
let currentCardIndex = 0;
let quizData = null;
let streamTimeout = null;

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
  loadingText.textContent = 'Generating ' + label.toLowerCase() + '...';
  showView(loadingState);

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
    onStreamComplete();
  }, 15000);

  rawText += text;

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
  clearTimeout(streamTimeout);

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
    let json = rawText.trim();
    if (json.startsWith('```')) {
      json = json.replace(/^```\w*\n/, '').replace(/\n```$/, '');
    }
    flashcards = JSON.parse(json);
  } catch (e) {
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
  $('cardCounter').textContent = (currentCardIndex + 1) + ' / ' + flashcards.length;
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
    div.innerHTML = '<h4>Q' + (qi + 1) + '. ' + escapeHtml(q.question) + '</h4>' +
      q.options.map((opt, oi) =>
        '<label class="sp-quiz-option" data-qi="' + qi + '" data-oi="' + oi + '">' +
        '<input type="radio" name="q' + qi + '" value="' + oi + '">' +
        '<span>' + escapeHtml(opt) + '</span>' +
        '</label>'
      ).join('') +
      '<div class="sp-quiz-explanation" id="explanation-' + qi + '">' + escapeHtml(q.explanation || '') + '</div>';
    container.appendChild(div);
  });
}

$('quizSubmit').addEventListener('click', () => {
  if (!quizData) return;
  const questions = quizData.questions;
  let score = 0;

  questions.forEach((q, qi) => {
    const selected = document.querySelector('input[name="q' + qi + '"]:checked');
    const selectedIdx = selected ? parseInt(selected.value) : -1;
    const correctIdx = q.correct;

    document.querySelectorAll('[data-qi="' + qi + '"]').forEach(opt => {
      const oi = parseInt(opt.dataset.oi);
      opt.classList.remove('selected', 'correct', 'incorrect');
      if (oi === correctIdx) opt.classList.add('correct');
      if (oi === selectedIdx && selectedIdx !== correctIdx) opt.classList.add('incorrect');
    });

    document.getElementById('explanation-' + qi).style.display = 'block';
    if (selectedIdx === correctIdx) score++;
  });

  $('quizSubmit').style.display = 'none';
  const scoreEl = $('quizScore');
  scoreEl.style.display = 'block';
  scoreEl.textContent = 'Score: ' + score + ' / ' + questions.length + ' (' + Math.round(score / questions.length * 100) + '%)';
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
    card.innerHTML = '<div class="sp-term">' + escapeHtml(t.term) + '</div>' +
      '<div class="sp-definition">' + escapeHtml(t.definition) + '</div>';
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
  let bodyContent = '';
  const label = ACTION_LABELS[currentAction] || currentAction;

  if (['notes', 'study-guide', 'summary'].includes(currentAction)) {
    bodyContent = __studySnapParseMarkdown(rawText);
  } else if (currentAction === 'flashcards' && flashcards.length > 0) {
    bodyContent = '<h1>Flashcards</h1><table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%">' +
      '<tr style="background:#f0f0f0"><th>Question</th><th>Answer</th></tr>' +
      flashcards.map(c => '<tr><td>' + escapeHtml(c.front) + '</td><td>' + escapeHtml(c.back) + '</td></tr>').join('') +
      '</table>';
  } else if (currentAction === 'practice-quiz' && quizData) {
    bodyContent = '<h1>Practice Quiz</h1>' +
      quizData.questions.map((q, i) =>
        '<h3>Q' + (i + 1) + '. ' + escapeHtml(q.question) + '</h3>' +
        '<ol type="A">' + q.options.map((opt, oi) =>
          '<li' + (oi === q.correct ? ' style="font-weight:bold;color:#166534"' : '') + '>' +
          escapeHtml(opt.replace(/^[A-D]\)\s*/, '')) +
          (oi === q.correct ? ' &#x2713;' : '') + '</li>'
        ).join('') + '</ol>' +
        (q.explanation ? '<p style="color:#166534;font-style:italic">' + escapeHtml(q.explanation) + '</p>' : '')
      ).join('');
  } else if (currentAction === 'key-terms') {
    let terms = [];
    try {
      let json = rawText.trim();
      if (json.startsWith('```')) json = json.replace(/^```\w*\n/, '').replace(/\n```$/, '');
      terms = JSON.parse(json);
    } catch (e) {
      const match = rawText.match(/\[[\s\S]*\]/);
      if (match) try { terms = JSON.parse(match[0]); } catch (e2) {}
    }
    bodyContent = '<h1>Key Terms</h1><table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%">' +
      '<tr style="background:#f0f0f0"><th>Term</th><th>Definition</th></tr>' +
      terms.map(t => '<tr><td style="font-weight:bold">' + escapeHtml(t.term) + '</td><td>' + escapeHtml(t.definition) + '</td></tr>').join('') +
      '</table>';
  } else {
    bodyContent = __studySnapParseMarkdown(rawText);
  }

  const docHtml = '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
    'xmlns:w="urn:schemas-microsoft-com:office:word" ' +
    'xmlns="http://www.w3.org/TR/REC-html40">' +
    '<head><meta charset="utf-8"><title>StudyBuddy - ' + escapeHtml(label) + '</title>' +
    '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->' +
    '<style>' +
    'body { font-family: Calibri, sans-serif; font-size: 11pt; line-height: 1.6; color: #1e293b; max-width: 7in; margin: 0 auto; }' +
    'h1 { font-size: 20pt; color: #0f172a; margin-top: 16pt; }' +
    'h2 { font-size: 16pt; color: #1e293b; border-bottom: 1pt solid #e2e8f0; padding-bottom: 4pt; margin-top: 14pt; }' +
    'h3 { font-size: 13pt; color: #334155; margin-top: 12pt; }' +
    'h4 { font-size: 11pt; color: #475569; margin-top: 10pt; }' +
    'p { margin: 6pt 0; }' +
    'ul, ol { margin: 6pt 0; padding-left: 24pt; }' +
    'li { margin: 3pt 0; }' +
    'code { font-family: Consolas, monospace; font-size: 10pt; background: #f1f5f9; padding: 1pt 3pt; }' +
    'pre { font-family: Consolas, monospace; font-size: 10pt; background: #f1f5f9; padding: 8pt; border: 1pt solid #e2e8f0; overflow-x: auto; }' +
    'pre code { background: none; padding: 0; }' +
    'table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 10pt; }' +
    'th, td { border: 1pt solid #cbd5e1; padding: 6pt 8pt; text-align: left; }' +
    'th { background: #f1f5f9; font-weight: bold; }' +
    'strong { color: #0f172a; }' +
    'a { color: #3B82F6; }' +
    'hr { border: none; border-top: 1pt solid #e2e8f0; margin: 12pt 0; }' +
    '</style></head><body>' + bodyContent + '</body></html>';

  const blob = new Blob([docHtml], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'studysnap-' + currentAction + '-' + Date.now() + '.doc';
  a.click();
  URL.revokeObjectURL(url);
});

$('regenerateBtn').addEventListener('click', () => {
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

  const model = $('modelSelect').value;

  await chrome.storage.local.set({ anthropic_api_key: apiKey });
  await chrome.storage.sync.set({ default_action: defaultAction, model: model });

  const btn = $('saveSettings');
  btn.textContent = 'Saved!';
  setTimeout(() => btn.textContent = 'Save Settings', 1500);
});

async function loadSettings() {
  const { anthropic_api_key = '' } = await chrome.storage.local.get('anthropic_api_key');
  const { default_action = 'study-guide', model = 'claude-sonnet-4-5-20250929' } = await chrome.storage.sync.get(['default_action', 'model']);
  $('apiKeyInput').value = anthropic_api_key;
  $('defaultAction').value = default_action;
  $('modelSelect').value = model;

  const { usage_today = 0, usage_date = '' } = await chrome.storage.local.get(['usage_today', 'usage_date']);
  const today = new Date().toISOString().split('T')[0];
  if (usage_date === today) {
    $('usageInfo').textContent = usage_today + ' transformation' + (usage_today !== 1 ? 's' : '') + ' today';
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
