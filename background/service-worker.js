// background/service-worker.js
console.log('StudySnap service worker loaded');

chrome.action.onClicked.addListener(async (tab) => {
  console.log('StudySnap icon clicked on tab', tab.id);
});
