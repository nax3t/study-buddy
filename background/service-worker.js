// background/service-worker.js
console.log('StudySnap service worker loaded');

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
    console.warn('Cannot inject into this page');
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'toggle-inspector' });
    console.log('Inspector toggled:', response);
  } catch (e) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/utils.js', 'content/inspector.js']
    });
    console.log('Inspector injected into tab', tab.id);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'inspector-deactivated') {
    console.log('Inspector deactivated on tab', sender.tab?.id);
  }
});
