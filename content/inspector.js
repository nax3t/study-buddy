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
