// sidepanel/sidepanel.js

// --- State ---
let currentAction = null;
let rawText = '';
let flashcards = [];
let currentCardIndex = 0;
let quizData = null;

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
}

function onStreamDelta(text) {
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
  const blob = new Blob([rawText], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'studysnap-' + currentAction + '-' + Date.now() + '.md';
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
