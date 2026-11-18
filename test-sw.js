// test-sw.js - runs the real stage3/sw.js inside a pretend browser and checks what it shows.
// Run: node --test test-sw.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SW = fs.readFileSync(process.env.SW || path.join(__dirname, 'stage3', 'sw.js'), 'utf8');

// A pretend browser: caches, fetch, notifications. answers = what the web app says, one per fetch.
function browser(answers, setup) {
  const shown = [], listeners = {}, store = {}, posted = [], opened = [];
  let fetches = 0;
  let clock = 1000;
  const caches = {
    open: async (name) => ({
      match: async (key) => store[name + key] === undefined ? undefined : { json: async () => JSON.parse(store[name + key]) },
      put: async (key, res) => { store[name + key] = await res.text(); },
    }),
  };
  if (setup !== null) store['push-setup/setup.json'] = JSON.stringify(setup || { script: 'https://example/exec', id: 'abc' });
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    clients: { claim: async () => {}, matchAll: async () => [{ postMessage: (m) => posted.push(m) }], openWindow: async (u) => { opened.push(u); } },
    registration: {
      // Like iPhone: showing a notification with the same tag does NOT replace the old one. Only close() takes one away.
      showNotification: async (title, opts) => { await new Promise((r) => setTimeout(r, 1)); shown.push(Object.assign({ title, closed: false }, opts)); },
      getNotifications: async (filter) => shown.filter((n) => !n.closed && (!filter || !filter.tag || n.tag === filter.tag))
        .map((n) => ({ tag: n.tag, title: n.title, close: () => { n.closed = true; } })),
    },
  };
  const fetch = async () => {
    fetches++;
    const a = answers.shift();
    if (a instanceof Error) throw a;
    return { json: async () => a };
  };
  const ctx = {
    self, caches, fetch, Response: class { constructor(t) { this.t = t; } async text() { return this.t; } },
    AbortController, setTimeout, clearTimeout, console,
    Date: Object.assign(function () { return new Date(clock); }, { now: () => clock++ }),
  };
  vm.createContext(ctx);
  vm.runInContext(SW, ctx);
  // data: undefined = an EMPTY push (the old way); an object = words inside the push; 'BROKEN' = data that is not JSON
  const dataOf = (data) => data === undefined ? null : data === 'BROKEN'
    ? { json: () => { throw new SyntaxError('bad'); }, text: () => '{not json' }
    : { json: () => JSON.parse(JSON.stringify(data)), text: () => JSON.stringify(data) };
  async function push(data) {
    let done;
    listeners.push({ data: dataOf(data), waitUntil: (p) => { done = p; } });
    await done;
  }
  async function click(n) {
    let done;
    listeners.notificationclick({ notification: { data: n.data, close: () => {} }, waitUntil: (p) => { done = p; } });
    await done;
  }
  function pushNoWait(data) { let done; listeners.push({ data: dataOf(data), waitUntil: (p) => { done = p; } }); return done; }
  const onScreen = () => shown.filter((n) => !n.closed);
  async function log() { return store['push-log/push-log.json'] ? JSON.parse(store['push-log/push-log.json']) : []; }
  return { push, pushNoWait, onScreen, shown, posted, log, listeners, opened, click, fetches: () => fetches };
}


// ---- Version 1 (ruling 17 Nov 10:33pm): the words ALWAYS travel inside the push. The worker never calls the sheet. ----
// The shape is Apple's Declarative Web Push: { web_push: 8030, notification: { title, body, navigate, tag } }.
// (Seen live 17 Nov on an iPhone 16, iOS 27.2: Apple draws these itself and the worker does not run. Android and computers run the worker.)
const WORDS = (title, body, tag, navigate) => ({ web_push: 8030, notification: { title, body, tag, navigate: navigate === undefined ? 'https://example.web.app/' : navigate } });

test('a push that carries its words shows them at once and never calls the sheet', async () => {
  const b = browser([]);
  await b.push(WORDS('New job', 'Dave Miller, 45 Mann St', 'push-from-sheet-5'));
  assert.equal(b.fetches(), 0);
  assert.equal(b.shown.length, 1);
  assert.equal(b.shown[0].title, 'New job');
  assert.equal(b.shown[0].body, 'Dave Miller, 45 Mann St');
  assert.equal(b.shown[0].tag, 'push-from-sheet-5');
});

test('an EMPTY push still shows something, and never calls the sheet (there is no fetch-back any more)', async () => {
  const b = browser([{ ok: true, title: 'From the sheet', body: 'y', at: 4 }]);
  await b.push();
  assert.equal(b.fetches(), 0);
  assert.equal(b.shown.length, 1);
  assert.equal(b.shown[0].title, 'New message');
  assert.equal(b.shown[0].body, 'Open the app to see it.');
});

test('carried words that cannot be read still show something, and never call the sheet', async () => {
  for (const bad of ['BROKEN', { hello: 1 }, { web_push: 8030 }, { web_push: 8030, notification: { title: '' } }, { web_push: 8030, notification: { title: 5 } },
    { web_push: 1, notification: { title: 'x', navigate: 'https://a.web.app/' } }, { notification: { title: 'x', navigate: 'https://a.web.app/' } }]) {
    const b = browser([{ ok: true, title: 'From the sheet', body: 'y', at: 4 }]);
    await b.push(bad);
    assert.equal(b.fetches(), 0, JSON.stringify(bad));
    assert.equal(b.shown.length, 1);
    assert.equal(b.shown[0].title, 'New message', JSON.stringify(bad));
  }
});

test('a notification is ALWAYS shown, even with no setup saved', async () => {
  const b = browser([], null);
  await b.push();
  assert.equal(b.shown.length, 1);
  assert.equal(b.shown[0].title, 'New message');
});

test('each push with no readable words gets its own tag, so one never hides another', async () => {
  const b = browser([]);
  await b.push(); await b.push();
  assert.match(b.shown[0].tag, /^push-from-sheet-fallback-/);
  assert.notEqual(b.shown[0].tag, b.shown[1].tag);
  assert.equal(b.onScreen().length, 2);
});

test('a push with no readable words after a real message does not take the real message away', async () => {
  const b = browser([]);
  await b.push(WORDS('New job', 'A', 'push-from-sheet-1'));
  await b.push();
  assert.equal(b.onScreen().length, 2);
  assert.equal(b.onScreen()[0].body, 'A');
});

test('the same message carried twice leaves ONE on screen (iPhone does not replace by tag, so the worker closes the old one)', async () => {
  const b = browser([]);
  const m = WORDS('New job', 'x', 'push-from-sheet-9');
  await b.push(m); await b.push(m);
  assert.equal(b.shown.length, 2, 'every push still SHOWS one (iPhone needs one per push)');
  assert.equal(b.onScreen().length, 1);
});

test('the same message twice at the same moment still leaves ONE on screen (pushes are handled one at a time)', async () => {
  const b = browser([]);
  const m = WORDS('New job', 'x', 'push-from-sheet-9');
  await Promise.all([b.pushNoWait(m), b.pushNoWait(m)]);
  assert.equal(b.onScreen().length, 1);
});

test('two DIFFERENT messages both stay on screen', async () => {
  const b = browser([]);
  await b.push(WORDS('New job', 'A', 'push-from-sheet-1'));
  await b.push(WORDS('New job', 'B', 'push-from-sheet-2'));
  assert.deepEqual(b.onScreen().map((n) => n.body), ['A', 'B']);
});

test('a same-message repeat replaces quietly: renotify is never switched on', async () => {
  const b = browser([]);
  const m = WORDS('New job', 'x', 'push-from-sheet-5');
  await b.push(m); await b.push(m);
  assert.equal(b.shown[1].tag, 'push-from-sheet-5');
  assert.notEqual(b.shown[1].renotify, true);
});

test('a carried message with no body or no tag still shows, with its own tag', async () => {
  const b = browser([]);
  await b.push({ web_push: 8030, notification: { title: 'Only a title', navigate: 'https://example.web.app/' } });
  assert.equal(b.shown[0].title, 'Only a title');
  assert.equal(b.shown[0].body, '');
  assert.match(b.shown[0].tag, /^push-from-sheet-carried-/);
});

test('a carried body that is not text shows as empty, never as a number or an object', async () => {
  for (const bad of [5, { a: 1 }, true]) {
    const b = browser([]);
    await b.push({ web_push: 8030, notification: { title: 'T', body: bad, navigate: 'https://a.web.app/' } });
    assert.equal(b.shown[0].body, '', JSON.stringify(bad));
  }
});

test('every push is logged (carried or not), and the open page is told to refresh its log', async () => {
  const b = browser([]);
  await b.push(WORDS('New job', 'x', 'push-from-sheet-7'));
  await b.push();
  const log = await b.log();
  assert.equal(log.length, 2);
  assert.equal(log[0].words, 'carried in the push');
  assert.equal(log[0].shown, 'New job');
  assert.equal(log[1].words, 'no words in the push');
  assert.equal(log[1].shown, 'New message');
  assert.equal(JSON.stringify(b.posted), JSON.stringify([{ type: 'push-arrived' }, { type: 'push-arrived' }]));
});

test('tapping a notification that carried its words opens the address it carried', async () => {
  const b = browser([]);
  await b.push(WORDS('New job', 'x', 'push-from-sheet-1', 'https://www.appsheet.com/start/abc#view=Jobs_Detail&row=7'));
  await b.click(b.shown[0]);
  assert.deepEqual(b.opened, ['https://www.appsheet.com/start/abc#view=Jobs_Detail&row=7']);
});

test('tapping a notification with no address opens the page itself', async () => {
  const b = browser([]);
  await b.push();
  await b.click(b.shown[0]);
  assert.deepEqual(b.opened, ['./']);
});

test('an address that is not https is never opened - the page is opened instead', async () => {
  for (const bad of ['javascript:alert(1)', 'http://example.com/', 'data:text/html,hi', 42, '']) {
    const b = browser([]);
    await b.push(WORDS('New job', 'x', 'push-from-sheet-1', bad));
    await b.click(b.shown[0]);
    assert.deepEqual(b.opened, ['./'], String(bad));
  }
});

test('tapping never opens a non-https address, even if one is already stored on a notification', async () => {
  for (const bad of ['javascript:alert(1)', 'http://example.com/', 'data:text/html,hi']) {
    const b = browser([]);
    await b.click({ data: { navigate: bad } });
    assert.deepEqual(b.opened, ['./'], bad);
  }
});

test('when the page asks which version is running, the worker answers with its own version', async () => {
  const b = browser([]);
  const answers = [];
  b.listeners.message({ data: { type: 'version?' }, source: { postMessage: (m) => answers.push(m) } });
  assert.equal(answers.length, 1);
  assert.equal(answers[0].type, 'version');
  assert.equal(answers[0].worker, 'v11');
});

test('any other message to the worker gets no version answer', async () => {
  const b = browser([]);
  const answers = [];
  b.listeners.message({ data: { type: 'something-else' }, source: { postMessage: (m) => answers.push(m) } });
  b.listeners.message({ data: null, source: { postMessage: (m) => answers.push(m) } });
  assert.equal(answers.length, 0);
});

test('the fetch-back is gone from the worker', () => {
  assert.equal(/fetch\(/.test(SW), false);
  assert.equal(/action=latest/.test(SW), false);
});
