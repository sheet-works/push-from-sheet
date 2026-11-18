// test-page.js - runs the real script inside stage3/index.html in a pretend page and checks the log view.
// Run: node --test test-page.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const HTML = fs.readFileSync(process.env.PAGE || path.join(__dirname, 'stage3', 'index.html'), 'utf8');
const SCRIPT = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];

function page(opts) {
  opts = opts || {};
  const els = {}, docListeners = {}, winListeners = {};
  const el = (id) => els[id] || (els[id] = { id, textContent: '', innerHTML: '', style: { setProperty(k, v) { this[k] = v; } }, onclick: null, src: '' });
  let logData = null, savedSetup = null;   // savedSetup: what the page itself saved when it signed up (opts.remember)
  const caches = { open: async (name) => ({
    match: async () => (name === 'push-log' && logData) ? { json: async () => logData }
      : (name === 'push-setup' && opts.signedUp) ? { json: async () => ({ script: 'https://script.example/exec', id: 'ab'.repeat(16) }) }
      : (name === 'push-setup' && savedSetup) ? { json: async () => savedSetup } : undefined,
    put: async (key, res) => { if (name === 'push-setup' && opts.remember) savedSetup = JSON.parse(res.body); } }) };
  const document = { visibilityState: 'visible', getElementById: el,
    addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); } };
  const window = { isSecureContext: true, Notification: { permission: opts.permission || 'default' }, matchMedia: () => ({ matches: false }), navigator: { standalone: opts.standalone === true },
    addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); } };
  const navigator = { userAgent: opts.ua || 'Test' };
  const swListeners = {};
  if (opts.sw) navigator.serviceWorker = { addEventListener: (t, fn) => { (swListeners[t] = swListeners[t] || []).push(fn); } };
  const ctx = { document, window, navigator, caches, console, JSON, Uint8Array, Array, setTimeout, clearTimeout, URLSearchParams,
    location: { search: opts.search || '' }, CONFIG: undefined };
  const calls = [], recentCalls = [];
  if (opts.full) { // a browser that can sign up: service worker, push, the sheet's web app answering
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', unsubscribe: async () => true, toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: opts.keys }) };
    const reg = { active: { postMessage: () => {} }, pushManager: { getSubscription: async () => (opts.signedUp || opts.subOnly ? sub : null), subscribe: async () => sub } };
    navigator.serviceWorker = { addEventListener: () => {}, register: async () => reg, ready: Promise.resolve(reg) };
    window.PushManager = function () {};
    ctx.CONFIG = { name: 'Smith Plumbing', colour: opts.colour || '#2E7D32', script: 'https://script.example/exec', publicKey: 'BKfblLYJv7LbzUgmrq3IhrPOgvSi7A2EP6TuiGImFdTfFCdwt0I-DtPAGq-FGu338bcEXNJFv0nNAfcQW4t8KLg' };
    ctx.fetch = async (url) => {
      if (url.indexOf('action=recent') > 0) { // the Recent list asks the sheet (18 Nov); kept apart so the sign-up tests stay as they were
        recentCalls.push(url);
        if (opts.sheetRecent === 'down') throw new Error('offline');
        return { json: async () => (opts.sheetRecent ? (opts.waiting ? { ok: true, recent: opts.sheetRecent, waiting: true } : { ok: true, recent: opts.sheetRecent }) : { ok: false, error: 'not signed up' }) };
      }
      calls.push(url); return { json: async () => (opts.waiting ? { ok: true, name: 'ABAB', waiting: true } : { ok: true, name: 'ABAB' }) };
    };
    ctx.crypto = { getRandomValues: (b) => { b.fill(171); return b; } };
    ctx.atob = (t) => Buffer.from(t, 'base64').toString('binary');
    ctx.Response = function (body) { this.body = body; };
  }
  vm.createContext(ctx);
  vm.runInContext(SCRIPT, ctx);
  const settle = () => new Promise((r) => setTimeout(r, 5));
  return {
    el, settle, document, calls, ctx, recentCalls, opts,
    setLog: (l) => { logData = l; },
    fireDoc: async (t) => { (docListeners[t] || []).forEach((f) => f()); await settle(); },
    fireSw: async (data) => { (swListeners.message || []).forEach((f) => f({ data })); await settle(); },
    fireWin: async (t) => { (winListeners[t] || []).forEach((f) => f({ persisted: true })); await settle(); },
  };
}

test('coming back to the page (it becomes visible again) re-reads the push log', async () => {
  const p = page();
  await p.settle();
  p.setLog([{ at: '2026-11-17T00:00:00.000Z', shown: 'Kim Tran' }]);
  p.document.visibilityState = 'visible';
  await p.fireDoc('visibilitychange');
  assert.match(p.el('recent').innerHTML, /Kim Tran/);
});

test('a page restored from the back cache (pageshow) re-reads the push log', async () => {
  const p = page();
  await p.settle();
  p.setLog([{ at: '2026-11-17T00:00:00.000Z', shown: 'Lee Wong' }]);
  await p.fireWin('pageshow');
  assert.match(p.el('recent').innerHTML, /Lee Wong/);
});

test('going to the background does not touch the log', async () => {
  const p = page();
  await p.settle();
  p.el('recent').innerHTML = 'before';
  p.setLog([{ shown: 'X' }]);
  p.document.visibilityState = 'hidden';
  await p.fireDoc('visibilitychange');
  assert.equal(p.el('recent').innerHTML, 'before');
});

test('the page shows its own version as soon as it opens', async () => {
  const p = page();
  await p.settle();
  assert.match(p.el('version').textContent, /page v11/);
});

test('when the worker answers, the version line shows both and says nothing more when they match', async () => {
  const p = page({ sw: true });
  await p.settle();
  await p.fireSw({ type: 'version', worker: 'v11' });
  assert.equal(p.el('version').textContent, 'page v11, worker v11');
});

test('an old worker still running is called out', async () => {
  const p = page({ sw: true });
  await p.settle();
  await p.fireSw({ type: 'version', worker: 'v3' });
  assert.match(p.el('version').textContent, /worker v3/);
  assert.match(p.el('version').textContent, /close the app and open it again/);
});

test('a worker too old to answer leaves the line saying the worker is unknown', async () => {
  const p = page({ sw: true });
  await p.settle();
  assert.match(p.el('version').textContent, /worker not known/);
});

// Which of the four screens is showing (18 Nov: the picked look, 'Plain, in the owner's colours').
const SCREENS = ['before', 'iphone', 'on', 'blocked'];
function shown(p) {
  const on = SCREENS.filter((n) => p.el('scr-' + n).style.display === 'block');
  assert.equal(on.length, 1, 'exactly one screen shows: ' + JSON.stringify(SCREENS.map((n) => p.el('scr-' + n).style.display)));
  return on[0];
}

// ---- sign-up sends the phone's two encryption keys (17 Nov review) ----
const P256 = 'B' + 'A'.repeat(86), AUTH = 'q'.repeat(22);
const SIGNUP = 'https://script.example/exec?action=subscribe&id=' + 'ab'.repeat(16) + '&endpoint=' + encodeURIComponent('https://fcm.googleapis.com/fcm/send/abc');
const DEV = '&device=Other';

test('tapping Turn on sends the sheet the address and both encryption keys', async () => {
  const p = page({ full: true, keys: { p256dh: P256, auth: AUTH } });
  await p.settle();
  p.el('on').onclick();
  await p.settle();
  assert.deepEqual(p.calls, [SIGNUP + '&p256dh=' + P256 + '&auth=' + AUTH + DEV]);
  assert.equal(shown(p), 'on');
  assert.equal(p.el('devname').textContent, "This computer's name is ABAB.");
});

test('a browser that hands over only one key, or none, is NOT signed up - it is told to try again (version 1 needs both)', async () => {
  for (const keys of [{ p256dh: P256 }, { auth: AUTH }, undefined, { p256dh: '', auth: '' }]) {
    const p = page({ full: true, keys: keys });
    await p.settle();
    p.el('on').onclick();
    await p.settle();
    assert.deepEqual(p.calls, [], JSON.stringify(keys));
    assert.equal(p.el('status').textContent, 'This browser did not hand over its encryption keys, so it cannot get notifications. Close the app, open it again and tap Turn on.');
  }
});

// ---- an already signed-up phone hands its keys over just by opening the page (so older sign-ups gain keys) ----
test('opening the page on a signed-up phone quietly re-sends its sign-up, keys included', async () => {
  const p = page({ full: true, signedUp: true, keys: { p256dh: P256, auth: AUTH } });
  await p.settle();
  assert.deepEqual(p.calls, [SIGNUP + '&p256dh=' + P256 + '&auth=' + AUTH + DEV]);
  assert.equal(shown(p), 'on');
});

test('opening the page on a phone that is NOT signed up sends nothing', async () => {
  const p = page({ full: true, keys: { p256dh: P256, auth: AUTH } });
  await p.settle();
  assert.deepEqual(p.calls, []);
  assert.equal(shown(p), 'before');
});

test('opening the page on a signed-up phone whose browser gives no keys sends nothing and still says ON', async () => {
  const p = page({ full: true, signedUp: true, keys: undefined });
  await p.settle();
  assert.deepEqual(p.calls, []);
  assert.equal(shown(p), 'on');
  assert.equal(p.el('status').textContent, '', 'no error shown');
});

test('a browser that still has a push sign-up but lost the saved setup sends nothing and asks for Turn on', async () => {
  const p = page({ full: true, subOnly: true, keys: { p256dh: P256, auth: AUTH } });
  await p.settle();
  assert.deepEqual(p.calls, []);
  assert.equal(shown(p), 'before');
  assert.equal(p.el('status').textContent, '', 'no error shown');
});

// ---- owner controls (17 Nov): the page tells the sheet which kind of device it is, and passes on an email from the AppSheet link ----
const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 15; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 15; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
  macsafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Safari/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0'
};
async function signupUrl(opts) {
  const p = page(Object.assign({ full: true, keys: { p256dh: P256, auth: AUTH } }, opts));
  await p.settle();
  p.el('on').onclick();
  await p.settle();
  return p.calls[0];
}
test('device names: iPhone, Android (Chrome or Samsung), Mac (Chrome or Safari), Windows (Edge, Firefox)', async () => {
  // (an iPhone in Safari never signs up any more: it is shown the Home Screen steps - see the 18 Nov tests)
  const want = { android: 'Android, Chrome', samsung: 'Android, Samsung Internet', mac: 'Mac, Chrome', macsafari: 'Mac, Safari', windows: 'Windows, Edge', firefox: 'Windows, Firefox' };
  for (const k of Object.keys(want)) {
    const u = await signupUrl({ ua: UA[k] });
    assert.ok(u.endsWith('&device=' + encodeURIComponent(want[k])), k + ': ' + u);
  }
});

test('an email on the page address (from the AppSheet link) is passed on to the sheet', async () => {
  const u = await signupUrl({ search: '?email=sam%40example.com' });
  assert.ok(u.endsWith('&device=Other&email=' + encodeURIComponent('sam@example.com')), u);
});

test('no email on the page address = no email sent', async () => {
  const u = await signupUrl({ search: '?x=1' });
  assert.ok(u.indexOf('email=') < 0, u);
});

test('an iPhone running the page from the Home Screen says so', async () => {
  const u = await signupUrl({ ua: UA.iphone, standalone: true });
  assert.ok(u.endsWith('&device=' + encodeURIComponent('iPhone, Home Screen')), u);
});

// ---- 18 Nov: the new look - the pick 'Plain, in the owner's colours' (design canvas, Plain-* artboards) ----
test('the owner\'s name is on the page, and the words say phone or computer to match the device', async () => {
  let p = page({ full: true, keys: { p256dh: P256, auth: AUTH } });
  await p.settle();
  assert.equal(shown(p), 'before');
  assert.equal(p.el('title-before').textContent, 'Get notifications from Smith Plumbing on this computer');
  assert.equal(p.el('lead-before').textContent, 'When Smith Plumbing sends something new, it pops up on this computer.');
  assert.ok(p.el('appname').textContent === 'Smith Plumbing');
  p = page({ full: true, ua: UA.android, keys: { p256dh: P256, auth: AUTH } });
  await p.settle();
  assert.equal(p.el('title-before').textContent, 'Get notifications from Smith Plumbing on this phone');
  assert.equal(p.el('lead-before').textContent, 'When Smith Plumbing sends something new, it pops up on this phone like a text message.');
});

test('the owner\'s colour is used for the button and the icon tile; a colour that is not a colour is ignored', async () => {
  let p = page({ full: true, keys: { p256dh: P256, auth: AUTH } });
  await p.settle();
  assert.equal(p.el('page').style['--accent'], '#2E7D32');
  p = page({ full: true, colour: 'red;}body{display:none', keys: { p256dh: P256, auth: AUTH } });
  await p.settle();
  assert.equal(p.el('page').style['--accent'], '#1565C0');
});

test('an iPhone in Safari (not from the Home Screen) gets the three Home Screen steps, with the owner\'s name', async () => {
  const p = page({ full: true, ua: UA.iphone, keys: { p256dh: P256, auth: AUTH } });
  await p.settle();
  assert.equal(shown(p), 'iphone');
  assert.equal(p.el('title-iphone').textContent, 'First, add Smith Plumbing to your Home Screen');
  assert.match(p.el('step3').textContent, /Open Smith Plumbing from your Home Screen/);
});

test('an iPhone opened from the Home Screen gets the normal Turn on screen', async () => {
  const p = page({ full: true, ua: UA.iphone, standalone: true, keys: { p256dh: P256, auth: AUTH } });
  await p.settle();
  assert.equal(shown(p), 'before');
  assert.equal(p.el('title-before').textContent, 'Get notifications from Smith Plumbing on this phone');
});

test('a device that said no to notifications gets the blocked screen with how to change it', async () => {
  const p = page({ full: true, permission: 'denied', keys: { p256dh: P256, auth: AUTH } });
  await p.settle();
  assert.equal(shown(p), 'blocked');
  assert.equal(p.el('title-blocked').textContent, 'Notifications are blocked on this computer');
  assert.match(p.el('lead-blocked').textContent, /said no to notifications from Smith Plumbing/);
});

test('Turn off goes back to the first screen and says it is off', async () => {
  const p = page({ full: true, signedUp: true, keys: { p256dh: P256, auth: AUTH } });
  await p.settle();
  assert.equal(shown(p), 'on');
  await p.el('off').onclick();
  await p.settle();
  assert.equal(shown(p), 'before');
  assert.equal(p.el('status').textContent, 'Notifications are off on this computer.');
  assert.ok(p.calls.some((u) => u.indexOf('action=unsubscribe&id=') > 0));
});

test('Recent lists the last notifications, newest first, with the title and the message, and cannot be tricked into HTML', async () => {
  const p = page({ full: true, signedUp: true, keys: { p256dh: P256, auth: AUTH } });
  p.setLog([{ at: '2026-11-17T00:00:00.000Z', shown: 'Old one' }, { at: '2026-11-18T03:45:28.000Z', shown: '<b>New</b> job', body: 'Core drill & cut' }]);
  await p.settle();
  const html = p.el('recent').innerHTML;
  assert.ok(html.indexOf('&lt;b&gt;New&lt;/b&gt; job') >= 0 && html.indexOf('<b>New') < 0, html);
  assert.ok(html.indexOf('Core drill &amp; cut') >= 0, html);
  assert.ok(html.indexOf('New</b>') < 0);
  assert.ok(html.indexOf('&lt;b&gt;New') < html.indexOf('Old one'), 'newest first');
});

test('with nothing received yet, Recent says so plainly', async () => {
  const p = page({ full: true, signedUp: true, keys: { p256dh: P256, auth: AUTH } });
  await p.settle();
  assert.match(p.el('recent').innerHTML, /Nothing yet/);
});

test('a page whose config.js was never written says so, and offers no button', async () => {
  const p = page();
  await p.settle();
  assert.equal(shown(p), 'before');
  assert.equal(p.el('status').textContent, 'This page has not been set up yet. Ask whoever sent you the link.');
  assert.equal(p.el('on').style.display, 'none');
});

test('iPhone step 1 covers both Safari layouts: Share at the bottom, or behind the three-lines button by the address (the test iPhone, 18 Nov)', () => {
  const step1 = HTML.match(/<span class="n">1<\/span><span>([\s\S]*?)<\/span><\/li>/)[1].replace(/<svg[\s\S]*?<\/svg>/g, '[share]').replace(/<[^>]+>/g, '');
  assert.equal(step1, 'Tap the Share button [share]. It is at the bottom of Safari, or behind the three-lines button beside the address.');
});

// ---- 18 Nov: Recent comes from the sheet (on the test iPhone the worker's own log never reached the page) ----
test('a signed-up device shows the messages the sheet kept for it, newest first as the sheet gives them', async () => {
  const p = page({ full: true, signedUp: true, keys: { p256dh: P256, auth: AUTH },
    sheetRecent: [{ title: 'iPhone first push', body: 'Wall saw 3 m x 200 mm, 8 Mann St Gosford', at: Date.parse('2026-11-18T04:07:55Z') }, { title: 'Older', body: '', at: Date.parse('2026-11-17T01:00:00Z') }] });
  await p.settle(); await p.settle();
  assert.deepEqual(p.recentCalls, ['https://script.example/exec?action=recent&id=' + 'ab'.repeat(16)]);
  const html = p.el('recent').innerHTML;
  assert.ok(html.indexOf('iPhone first push') >= 0 && html.indexOf('Wall saw 3 m x 200 mm') >= 0, html);
  assert.ok(html.indexOf('iPhone first push') < html.indexOf('Older'));
});

test('if the sheet cannot be reached, Recent falls back to what this device kept itself', async () => {
  const p = page({ full: true, signedUp: true, keys: { p256dh: P256, auth: AUTH }, sheetRecent: 'down' });
  p.setLog([{ at: '2026-11-18T03:45:28.000Z', shown: 'Kept here', body: 'local' }]);
  await p.settle(); await p.settle();
  assert.match(p.el('recent').innerHTML, /Kept here/);
});

test('a device that is not signed up never asks the sheet for messages', async () => {
  const p = page({ full: true, keys: { p256dh: P256, auth: AUTH }, sheetRecent: [] });
  await p.settle(); await p.settle();
  await p.fireDoc('visibilitychange'); await p.fireWin('pageshow');
  assert.deepEqual(p.recentCalls, []);
});

// ---- 18 Nov cold test (jobtester's iPhone): the page said "Notifications are on" while the device was still waiting
// for the sheet's owner to let it in. Page v10 says which it is. ----
const ON = 'Notifications are on', WAITING = 'Waiting to be let in';
test('a device that signs up and has to be let in is told it is waiting, with its name to give the owner', async () => {
  const p = page({ full: true, keys: { p256dh: P256, auth: AUTH }, waiting: true });
  await p.settle();
  p.el('on').onclick();
  await p.settle();
  assert.equal(shown(p), 'on');
  assert.equal(p.el('title-on').textContent, WAITING);
  assert.equal(p.el('devname').textContent, "This computer's name is ABAB. Notifications start once the owner of Smith Plumbing lets it in.");
});

test('a device that is let in straight away is told notifications are on', async () => {
  const p = page({ full: true, keys: { p256dh: P256, auth: AUTH } });
  await p.settle();
  p.el('on').onclick();
  await p.settle();
  assert.equal(p.el('title-on').textContent, ON);
  assert.equal(p.el('devname').textContent, "This computer's name is ABAB.");
});

test('opening the page while still waiting says waiting; coming back after the owner lets it in says ON', async () => {
  const p = page({ full: true, signedUp: true, keys: { p256dh: P256, auth: AUTH }, sheetRecent: [], waiting: true });
  await p.settle(); await p.settle();
  assert.equal(p.el('title-on').textContent, WAITING);
  assert.match(p.el('devname').textContent, /^This computer's name is ABAB\. Notifications start once the owner of Smith Plumbing lets it in\.$/);
  p.opts.waiting = false;                      // the owner ticks Let in
  await p.fireDoc('visibilitychange');         // the device comes back to the page
  assert.equal(p.el('title-on').textContent, ON);
  assert.equal(p.el('devname').textContent, "This computer's name is ABAB.");
});

test('if the sheet cannot be reached, a signed-up device is not told it is waiting', async () => {
  const p = page({ full: true, signedUp: true, keys: { p256dh: P256, auth: AUTH }, sheetRecent: 'down', waiting: true });
  await p.settle(); await p.settle();
  assert.equal(p.el('title-on').textContent, ON);
});

test('a waiting device stays "waiting" when the sheet refuses its Recent question (only a real answer changes it)', async () => {
  const p = page({ full: true, keys: { p256dh: P256, auth: AUTH }, waiting: true, remember: true });   // no sheetRecent = the sheet answers ok:false
  await p.settle();
  p.el('on').onclick();
  await p.settle(); await p.settle();
  assert.equal(p.recentCalls.length, 1, 'it did ask the sheet');
  assert.equal(p.el('title-on').textContent, WAITING);
});

// 18 Nov 6:50pm: a green tick above "Waiting to be let in" reads like it is already on. Page v11 hides it while waiting.
test('the tick is hidden while a device waits, and shows once it is let in', async () => {
  const p = page({ full: true, signedUp: true, keys: { p256dh: P256, auth: AUTH }, sheetRecent: [], waiting: true });
  await p.settle(); await p.settle();
  assert.equal(p.el('tick-on').style.display, 'none');
  p.opts.waiting = false;
  await p.fireDoc('visibilitychange');
  assert.equal(p.el('tick-on').style.display, '');
  assert.ok(/<svg id="tick-on"/.test(HTML), 'the tick on the On screen carries the id');
});
