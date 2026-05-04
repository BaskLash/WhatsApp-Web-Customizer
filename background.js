// background.js — MV3 service worker.
//
// Listener registrations (analytics.initAnalytics) MUST be at the top
// level. The SW is reinitialized on event wake-ups; async-registered
// listeners would miss the event that woke them.

importScripts("analytics.js");

self.analytics.initAnalytics();

chrome.runtime.setUninstallURL(
  "https://docs.google.com/forms/d/e/1FAIpQLSc92IabrxttJJ1dmLj6QbejXlkHffnd8lxjy1lVjDvALQCkrQ/viewform?usp=sharing&ouid=107403711423930702162",
);
