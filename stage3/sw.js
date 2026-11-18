// sw.js - the service worker for the phone page.
// Version 1 (ruling 17 Nov 2026): the sheet locks the words and puts them INSIDE the push; the browser unlocks them
// before this worker sees them. The worker never calls the sheet back.
// Seen live 17 Nov: on iPhone (iOS 27.2) Apple draws these pushes itself and this worker does not run for them.
// On Android and computers this worker draws the notification.
// It must ALWAYS show a notification (Safari takes the permission away otherwise), so a push with no readable words
// still shows plain fall-back words.

var WORKER_VERSION = 'v11'; // shown on the page so you can see which worker the phone is really running. Change with every upload of sw.js.

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });

// iPhone does NOT replace a notification that has the same tag (seen 17 Nov: a nudged iPhone showed one job twice).
// So before showing, the worker closes any notification already showing with the same tag itself.
// It must still show one every time - iPhone needs a shown notification for every push.
async function showOnce(title, options) {
  try {
    var same = await self.registration.getNotifications({ tag: options.tag });
    same.forEach(function (n) { n.close(); });
  } catch (e) { /* older browsers: fall back to the tag alone */ }
  await self.registration.showNotification(title, options);
}

// Pushes are handled one at a time, so a repeat that lands while the first is still busy
// waits its turn and then replaces it, instead of both checking at once and both showing.
var queue = Promise.resolve();

self.addEventListener('push', function (event) {
  var started = Date.now();
  var carried = readCarried(event.data);
  var job = queue.then(function () { return handlePush(started, carried); });
  queue = job.catch(function () {});
  event.waitUntil(job);
});

// Words carried INSIDE the push (17 Nov): { web_push: 8030, notification: { title, body, tag, navigate } }.
// The browser has already unlocked them. Anything not in that shape gives null, and the fall-back words are shown.
function readCarried(data) {
  try {
    var m = data && data.json();
    var n = m && m.web_push === 8030 && m.notification;
    if (!n || typeof n.title !== 'string' || !n.title) return null;
    return { title: n.title, body: typeof n.body === 'string' ? n.body : '', tag: typeof n.tag === 'string' && n.tag ? n.tag : '',
      navigate: typeof n.navigate === 'string' && n.navigate.indexOf('https://') === 0 ? n.navigate : '' };
  } catch (e) { return null; }
}

async function handlePush(started, carried) {
  {
    var title = 'New message', body = 'Open the app to see it.', how = 'no words in the push';
    var tag = 'push-from-sheet-fallback-' + started, navigate = '';
    if (carried) {
      title = carried.title; body = carried.body; how = 'carried in the push';
      tag = carried.tag || 'push-from-sheet-carried-' + started; navigate = carried.navigate;
    }
    try {
      var cache = await caches.open('push-log');
      var old = await cache.match('/push-log.json');
      var list = old ? await old.json() : [];
      list.push({ at: new Date(started).toISOString(), words: how, tookMs: Date.now() - started, shown: title, body: body });
      await cache.put('/push-log.json', new Response(JSON.stringify(list.slice(-20))));
    } catch (e) { /* the log is a nice-to-have */ }
    await showOnce(title, { body: body, icon: 'icon-192.png', tag: tag, data: { navigate: navigate } });
    var pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    pages.forEach(function (p) { p.postMessage({ type: 'push-arrived' }); });
  }
}

// The page asks 'version?' when it opens; answer with this worker's version.
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'version?' && event.source) event.source.postMessage({ type: 'version', worker: WORKER_VERSION });
});

// Tapping opens the address the push carried (e.g. the AppSheet record), or the page itself. Only https is ever opened.
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var d = event.notification.data, go = d && typeof d.navigate === 'string' && d.navigate.indexOf('https://') === 0 ? d.navigate : './';
  event.waitUntil(self.clients.openWindow(go));
});
