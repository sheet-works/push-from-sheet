'use strict';
// Tests for hub.js - the script-side logic for phones signing up.
// Version 1 (ruling 17 Nov 10:33pm): the words always travel INSIDE the push, so there is no
// fetch-back, no waiting line and no nudge. Every phone must give its two encryption keys to sign up.
// Run: node --test test-hub.js   (always name the test files)
// Rule: written BEFORE hub.js and seen to fail first.
const test = require('node:test');
const assert = require('node:assert/strict');
const HUB = require(process.env.HUB || './hub.js');

const NOW = 1794800000000; // milliseconds
const CFG = { publicKey: 'BPublicKeyForTests', maxPhones: 3, signup: 'open' }; // most tests are about open sign-up; owner approval has its own tests below
const ID_A = 'a'.repeat(32), ID_B = 'b'.repeat(32), ID_C = 'c'.repeat(32), ID_D = 'd'.repeat(32);
const FCM = 'https://fcm.googleapis.com/fcm/send/abc:APA91b-_x';
const APPLE = 'https://web.push.apple.com/QP2P2wd3DFe-Yo';
const P256 = 'B' + 'A'.repeat(86);   // the shape of a real key: 87 web-safe letters, always starting with B
const AUTH = 'q'.repeat(22);         // 22 web-safe letters
const P256_2 = 'B' + 'Z'.repeat(86), AUTH_2 = 'w'.repeat(22);

function newStore() {
  const m = new Map();
  return {
    get: k => (m.has(k) ? m.get(k) : null),
    set: (k, v) => { assert.equal(typeof v, 'string', 'the store only holds text'); m.set(k, v); },
    remove: k => { m.delete(k); },
    keys: () => Array.from(m.keys()),
    size: () => m.size
  };
}
const ask = (store, params, now, cfg) => HUB.handle(params, store, now || NOW, cfg || CFG);
// A normal sign-up: address plus both keys.
const sub = (s, id, endpoint, now, cfg, p, a) => ask(s, { action: 'subscribe', id: id, endpoint: endpoint || FCM, p256dh: p || P256, auth: a || AUTH }, now, cfg);
const rec = (id, endpoint, added, p, a) => ({ id: id, endpoint: endpoint || FCM, added: added || NOW, lastSend: 0, lastCode: 0, p256dh: p || P256, auth: a || AUTH });

test('asking for the key gives the public key and nothing else', () => {
  assert.deepEqual(ask(newStore(), { action: 'key' }), { ok: true, publicKey: 'BPublicKeyForTests' });
});

test('a phone signs up with its address and both keys, and gets a short name back', () => {
  const s = newStore();
  assert.deepEqual(sub(s, ID_A), { ok: true, name: 'AAAA' });
  assert.deepEqual(HUB.phones(s), [rec(ID_A)]);
});

test('a sign-up with NO keys is refused and nothing is saved (version 1 has no fetch-back)', () => {
  const s = newStore();
  assert.deepEqual(ask(s, { action: 'subscribe', id: ID_A, endpoint: FCM }), { ok: false, error: 'bad keys' });
  assert.equal(s.size(), 0);
});

test('bad or half-given keys are refused and nothing is saved', () => {
  const bad = [
    [P256, undefined], [undefined, AUTH], [P256, ''], ['', AUTH], ['', ''],
    ['B' + 'A'.repeat(85), AUTH], ['B' + 'A'.repeat(87), AUTH], ['C' + 'A'.repeat(86), AUTH], ['B' + 'A'.repeat(85) + '+', AUTH],
    [P256, 'q'.repeat(21)], [P256, 'q'.repeat(23)], [P256, 'q'.repeat(21) + '='], [P256, 'q'.repeat(21) + '/']
  ];
  for (const [p, a] of bad) {
    const s = newStore();
    assert.deepEqual(ask(s, { action: 'subscribe', id: ID_A, endpoint: FCM, p256dh: p, auth: a }), { ok: false, error: 'bad keys' }, String(p).length + ' / ' + String(a));
    assert.equal(s.size(), 0, 'nothing saved');
  }
});

test('signing up again with the same id updates the address and keys and keeps the first date', () => {
  const s = newStore();
  sub(s, ID_A, FCM, NOW);
  sub(s, ID_A, APPLE, NOW + 5000, null, P256_2, AUTH_2);
  assert.deepEqual(HUB.phones(s), [rec(ID_A, APPLE, NOW, P256_2, AUTH_2)]);
});

test('a signed-up phone that sends bad or no keys keeps what it had', () => {
  const s = newStore();
  sub(s, ID_A);
  assert.deepEqual(ask(s, { action: 'subscribe', id: ID_A, endpoint: APPLE, p256dh: P256_2, auth: 'short' }), { ok: false, error: 'bad keys' });
  assert.deepEqual(ask(s, { action: 'subscribe', id: ID_A, endpoint: APPLE }), { ok: false, error: 'bad keys' });
  assert.deepEqual(HUB.phones(s), [rec(ID_A)]);
});

test('only real push services can be signed up (so nobody can point the script at their own server)', () => {
  const good = [FCM, APPLE, 'https://api.push.apple.com/3/device/x', 'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
    'https://wns2-by3p.notify.windows.com/w/?token=abc'];
  const bad = ['https://evil.example.com/push', 'https://fcm.googleapis.com.evil.com/x', 'https://evil.com/fcm.googleapis.com/x',
    'https://evilpush.apple.com/x', 'https://web.push.apple.com.evil.com/x', 'https://fcm.googleapis.com@evil.com/x',
    'https://fcm.googleapis.com\\@evil.com/x', 'https://fcm.googleapis.com%40evil.com/x', 'https://x.push.apple.com@evil.com/x',
    'https://fcm.googleapis.com:8443/x', 'http://fcm.googleapis.com/fcm/send/x', 'https://push.apple.com/x',
    'https://notify.windows.com/x', '', 'fcm.googleapis.com/x', FCM + ' x', FCM + 'x'.repeat(700)];
  for (const e of good) assert.equal(HUB.allowedEndpoint(e), true, e);
  for (const e of bad) assert.equal(HUB.allowedEndpoint(e), false, e);
  for (const e of [null, undefined, 42, [FCM]]) assert.equal(HUB.allowedEndpoint(e), false);
  const s = newStore();
  assert.deepEqual(sub(s, ID_A, 'https://evil.example.com/push'), { ok: false, error: 'bad address' });
  assert.equal(s.size(), 0);
});

test('a sign-up needs a proper id (32 letters and digits made by the phone)', () => {
  const s = newStore();
  for (const id of ['', 'abc', 'A'.repeat(32), 'g'.repeat(32), 'a'.repeat(33), undefined]) {
    assert.deepEqual(sub(s, id), { ok: false, error: 'bad id' }, String(id));
  }
  assert.equal(s.size(), 0);
});

test('there is a cap on how many phones can sign up; a known phone can still update when full', () => {
  const s = newStore();
  for (const id of [ID_A, ID_B, ID_C]) assert.equal(sub(s, id).ok, true);
  assert.deepEqual(sub(s, ID_D), { ok: false, error: 'full' });
  assert.equal(sub(s, ID_B, APPLE).ok, true);
  assert.equal(HUB.phones(s).length, 3);
});

test('a phone can sign out; signing out twice is harmless', () => {
  const s = newStore();
  sub(s, ID_A);
  assert.deepEqual(ask(s, { action: 'unsubscribe', id: ID_A }), { ok: true });
  assert.deepEqual(ask(s, { action: 'unsubscribe', id: ID_A }), { ok: true });
  assert.equal(HUB.phones(s).length, 0);
  assert.equal(s.size(), 0);
});

test('signing out needs a proper id', () => {
  const s = newStore();
  sub(s, ID_A);
  assert.deepEqual(ask(s, { action: 'unsubscribe', id: 'nonsense' }), { ok: false, error: 'bad id' });
  assert.equal(HUB.phones(s).length, 1);
});

test('anything else asked of the web app is refused - including the old fetch-back ("latest")', () => {
  const s = newStore();
  sub(s, ID_A);
  const before = s.size();
  for (const p of [{}, { action: 'delete-everything' }, { action: 'setMessage', title: 'x' }, { action: 'latest', id: ID_A }, null, undefined]) {
    assert.deepEqual(ask(s, p), { ok: false, error: 'unknown action' });
  }
  assert.equal(s.size(), before);
});

test('the old fetch-back parts are gone from hub.js', () => {
  for (const name of ['setMessage', 'waitingPhones', 'waitForFetches']) assert.equal(HUB[name], undefined, name);
});

test('phones are listed oldest first, and other things in the store are left alone', () => {
  const s = newStore();
  s.set('STAGE2_TEST_KEY', 'secret');
  sub(s, ID_B, FCM, NOW + 10);
  sub(s, ID_A, APPLE, NOW + 20);
  assert.deepEqual(HUB.phones(s).map(p => p.id), [ID_B, ID_A]);
  assert.equal(s.get('STAGE2_TEST_KEY'), 'secret');
});

test('an old record with no keys (from before version 1) is never sent to - that phone must open the page again', () => {
  const s = newStore();
  s.set('phone_' + ID_A, JSON.stringify({ endpoint: FCM, added: NOW, lastFetch: 0, lastSend: 0, lastCode: 0 }));
  sub(s, ID_B);
  assert.deepEqual(HUB.phones(s).map(p => p.id), [ID_B]);
});

test('an old record with no keys gains them (and is sent to again) when its phone opens the page', () => {
  const s = newStore();
  s.set('phone_' + ID_A, JSON.stringify({ endpoint: FCM, added: NOW - 9, lastFetch: 5, lastSend: 0, lastCode: 0 }));
  assert.deepEqual(sub(s, ID_A, FCM, NOW), { ok: true, name: 'AAAA' });
  assert.deepEqual(HUB.phones(s), [rec(ID_A, FCM, NOW - 9)]);
});

test('after a send: 201 is noted; 404 and 410 mean the sign-up is dead and it is removed; other answers are kept on file', () => {
  const s = newStore();
  for (const id of [ID_A, ID_B, ID_C]) sub(s, id);
  assert.equal(HUB.recordSend(s, ID_A, 201, NOW + 1), 'sent');
  assert.equal(HUB.recordSend(s, ID_B, 410, NOW + 1), 'removed');
  assert.equal(HUB.recordSend(s, ID_C, 429, NOW + 1), 'failed');
  const p = HUB.phones(s);
  assert.deepEqual(p.map(x => x.id), [ID_A, ID_C]);
  assert.deepEqual([p[0].lastSend, p[0].lastCode], [NOW + 1, 201]);
  assert.deepEqual([p[1].lastSend, p[1].lastCode], [0, 429]);
  assert.equal(HUB.recordSend(s, ID_A, 404, NOW + 2), 'removed');
  assert.equal(HUB.recordSend(s, ID_D, 201, NOW + 2), 'unknown phone');
  assert.equal(s.keys().filter(k => k.indexOf('phone_') === 0).length, 1, 'removed phones leave nothing behind');
});

test('no big-number literals in hub.js (Apps Script refuses to save them)', () => {
  const src = require('node:fs').readFileSync(require.resolve(process.env.HUB || './hub.js'), 'utf8');
  assert.deepEqual(src.match(/\b(0x[0-9A-Fa-f]+|\d+)n\b/g) || [], []);
});

// ---- the owner lets each new phone in (ruling 17 Nov: on by default, a setting opens it up) ----
const OWNER = { publicKey: 'BPublicKeyForTests', maxPhones: 3, maxWaitingToJoin: 2 }; // no signup setting = the owner approves
const subOwner = (s, id, endpoint, now) => sub(s, id, endpoint, now, OWNER);

test('with owner approval (the default), a new phone signs up but waits to be let in', () => {
  const s = newStore();
  assert.deepEqual(subOwner(s, ID_A), { ok: true, name: 'AAAA', waiting: true });
  assert.deepEqual(HUB.phones(s), []);
  assert.deepEqual(HUB.waitingToJoin(s).map(p => [p.id, p.name, p.added]), [[ID_A, 'AAAA', NOW]]);
});

test('once the owner lets it in, the phone is listed to be sent to, keys and all', () => {
  const s = newStore();
  subOwner(s, ID_A);
  assert.equal(HUB.letIn(s, ID_A, OWNER), 'let in');
  assert.deepEqual(HUB.phones(s), [rec(ID_A)]);
  assert.deepEqual(HUB.waitingToJoin(s), []);
});

test('letting in a phone that is not there, or is already in, says so', () => {
  const s = newStore();
  assert.equal(HUB.letIn(s, ID_A, OWNER), 'unknown phone');
  subOwner(s, ID_A);
  HUB.letIn(s, ID_A, OWNER);
  assert.equal(HUB.letIn(s, ID_A, OWNER), 'already in');
});

test('signing up again keeps a phone where it was: waiting stays waiting, let-in stays let in', () => {
  const s = newStore();
  subOwner(s, ID_A);
  assert.equal(subOwner(s, ID_A, APPLE).waiting, true);
  HUB.letIn(s, ID_A, OWNER);
  assert.deepEqual(subOwner(s, ID_A, FCM), { ok: true, name: 'AAAA' });
  assert.deepEqual(HUB.phones(s).map(p => p.id), [ID_A]);
});

test('phones signed up before approval existed are treated as let in', () => {
  const s = newStore();
  s.set('phone_' + ID_A, JSON.stringify({ endpoint: FCM, added: NOW, lastSend: 0, lastCode: 0, p256dh: P256, auth: AUTH }));
  assert.deepEqual(HUB.phones(s).map(p => p.id), [ID_A]);
  assert.deepEqual(HUB.waitingToJoin(s), []);
});

test('open sign-up lets a phone straight in', () => {
  const s = newStore();
  const open = Object.assign({}, OWNER, { signup: 'open' });
  assert.deepEqual(sub(s, ID_A, FCM, NOW, open), { ok: true, name: 'AAAA' });
  assert.deepEqual(HUB.phones(s).map(p => p.id), [ID_A]);
});

test('any sign-up setting other than exactly "open" means the owner approves (a typo never opens it up)', () => {
  for (const setting of ['Open', 'yes', '', 'approve', undefined, null, true]) {
    const s = newStore();
    const cfg = Object.assign({}, OWNER, { signup: setting });
    assert.equal(sub(s, ID_A, FCM, NOW, cfg).waiting, true, String(setting));
  }
});

test('only so many phones can wait to be let in, so strangers cannot pile up', () => {
  const s = newStore();
  subOwner(s, ID_A);
  subOwner(s, ID_B);
  assert.deepEqual(subOwner(s, ID_C), { ok: false, error: 'too many waiting' });
  assert.equal(subOwner(s, ID_A, APPLE).ok, true); // one already waiting can still renew
});

test('the waiting limit defaults to 10 when not set', () => {
  const s = newStore();
  const cfg = { publicKey: 'k', maxPhones: 3 };
  const ids = Array.from({ length: 11 }, (_, i) => i.toString(16).padStart(32, '0'));
  const answers = ids.map(id => sub(s, id, FCM, NOW, cfg));
  assert.equal(answers.filter(a => a.ok).length, 10);
  assert.equal(answers[10].error, 'too many waiting');
});

test('waiting phones do not use up the places for let-in phones', () => {
  const s = newStore();
  subOwner(s, ID_A);
  subOwner(s, ID_B);
  ['1', '2', '3'].forEach(c => { const id = c.repeat(32); s.set('phone_' + id, JSON.stringify({ endpoint: FCM, added: NOW, lastSend: 0, lastCode: 0, p256dh: P256, auth: AUTH })); });
  assert.equal(HUB.phones(s).length, 3);
  assert.equal(HUB.letIn(s, ID_A, OWNER), 'full');
});

test('a waiting phone keeps its keys when the owner lets it in', () => {
  const s = newStore();
  subOwner(s, ID_A, FCM);
  subOwner(s, ID_A, APPLE); // renews with the same keys while waiting
  assert.equal(HUB.letIn(s, ID_A, OWNER), 'let in');
  assert.deepEqual(HUB.phones(s).map(p => [p.endpoint, p.p256dh, p.auth]), [[APPLE, P256, AUTH]]);
});

// ---- owner controls (Phones tab, 17 Nov): email from the sign-up link, device, last seen; ticks and deletes from the tab ----
test('a sign-up can carry an email (from the AppSheet link) and a device name; both are kept, trimmed', () => {
  const s = newStore();
  ask(s, { action: 'subscribe', id: ID_A, endpoint: FCM, p256dh: P256, auth: AUTH, email: '  Sam@Example.com ', device: 'iPhone, Home Screen' });
  const r = HUB.records(s)[0];
  assert.equal(r.email, 'Sam@Example.com');
  assert.equal(r.device, 'iPhone, Home Screen');
});

test('a bad email is not kept (the sign-up still works); an odd device name is cleaned and cut to 40 characters', () => {
  for (const bad of ['sam', 'sam@', '@x.com', 'sam @x.com', 'a@b', 'x'.repeat(250) + '@x.com', 'sam@' + 'x'.repeat(250) + '.com', '<b>@x.com']) {
    const s = newStore();
    assert.equal(ask(s, { action: 'subscribe', id: ID_A, endpoint: FCM, p256dh: P256, auth: AUTH, email: bad }).ok, true, bad);
    assert.equal(HUB.records(s)[0].email, '', bad);
  }
  const s = newStore();
  ask(s, { action: 'subscribe', id: ID_A, endpoint: FCM, p256dh: P256, auth: AUTH, device: '<script>Mac, Chrome' + 'x'.repeat(60) });
  const d = HUB.records(s)[0].device;
  assert.equal(d.length, 40);
  assert.ok(!/[<>]/.test(d));
});

test('signing up again with no email keeps the email it had', () => {
  const s = newStore();
  ask(s, { action: 'subscribe', id: ID_A, endpoint: FCM, p256dh: P256, auth: AUTH, email: 'sam@x.com' });
  sub(s, ID_A);
  assert.equal(HUB.records(s)[0].email, 'sam@x.com');
});

test('every sign-up (and every quiet re-send when the page opens) notes when the phone was last seen', () => {
  const s = newStore();
  sub(s, ID_A, FCM, NOW);
  sub(s, ID_A, FCM, NOW + 5000);
  assert.equal(HUB.records(s)[0].lastSeen, NOW + 5000);
  assert.equal(HUB.records(s)[0].added, NOW);
});

test('records lists every stored phone, let in or waiting, with what the Phones tab needs', () => {
  const s = newStore();
  sub(s, ID_A, FCM, NOW, OWNER);
  sub(s, ID_B, FCM, NOW + 1, CFG);
  s.set('phone_' + ID_C, JSON.stringify({ endpoint: FCM, added: NOW + 2, lastSend: 0, lastCode: 0 }));
  assert.deepEqual(HUB.records(s), [
    { id: ID_A, approved: false, stopped: false, listed: false, added: NOW, lastSeen: NOW, lastSend: 0, email: '', device: '', keys: true },
    { id: ID_B, approved: true, stopped: false, listed: false, added: NOW + 1, lastSeen: NOW + 1, lastSend: 0, email: '', device: '', keys: true },
    { id: ID_C, approved: true, stopped: false, listed: false, added: NOW + 2, lastSeen: 0, lastSend: 0, email: '', device: '', keys: false }
  ]);
});

test('records come oldest first, whatever order they were stored in', () => {
  const s = newStore();
  sub(s, ID_B, FCM, NOW + 10);
  sub(s, ID_A, FCM, NOW + 20);
  sub(s, ID_C, FCM, NOW + 5);
  assert.deepEqual(HUB.records(s).map(r => r.id), [ID_C, ID_B, ID_A]);
});

test('the Phones tab can let a phone in, stop it, mark it listed, or remove it', () => {
  const s = newStore();
  sub(s, ID_A, FCM, NOW, OWNER);
  HUB.update(s, { id: ID_A, approved: true, listed: true });
  assert.deepEqual(HUB.phones(s).map(p => p.id), [ID_A]);
  HUB.update(s, { id: ID_A, approved: false, stopped: true });
  assert.deepEqual(HUB.phones(s), []);
  const r = HUB.records(s)[0];
  assert.deepEqual([r.approved, r.stopped, r.listed], [false, true, true]);
  HUB.update(s, { id: ID_A, remove: true });
  assert.deepEqual(HUB.records(s), []);
  assert.equal(s.size(), 0);
});

test('a stopped phone opening the page again stays stopped (only the owner can start it)', () => {
  const s = newStore();
  sub(s, ID_A);
  HUB.update(s, { id: ID_A, approved: false, stopped: true });
  assert.deepEqual(sub(s, ID_A), { ok: true, name: 'AAAA', waiting: true });
  assert.deepEqual(HUB.phones(s), []);
});

test('updating a phone that is not there is harmless', () => {
  const s = newStore();
  assert.doesNotThrow(() => HUB.update(s, { id: ID_A, approved: true }));
  assert.equal(s.size(), 0);
});

// ---- 18 Nov: Recent comes from the sheet. On the test iPhone (page v9, worker v9) the worker's own log never reached the
// page (also seen 17 Nov), so the page asks the sheet: the sheet keeps each device's last 10 delivered messages. ----
test('a delivered message is kept for that device (title, message, time); a failed or refused one is not', () => {
  const s = newStore(); sub(s, ID_A); sub(s, ID_B);
  HUB.recordSend(s, ID_A, 201, NOW + 5, { title: 'Job one', body: 'Core drill, 12 Smith St', at: NOW + 4 });
  HUB.recordSend(s, ID_B, 429, NOW + 5, { title: 'Job one', body: 'x', at: NOW + 4 });
  assert.deepEqual(ask(s, { action: 'recent', id: ID_A }), { ok: true, recent: [{ title: 'Job one', body: 'Core drill, 12 Smith St', at: NOW + 4 }] });
  assert.deepEqual(ask(s, { action: 'recent', id: ID_B }), { ok: true, recent: [] });
});

test('recent: newest first, only the last 10, long words cut so a device record stays small', () => {
  const s = newStore(); sub(s, ID_A);
  for (let i = 1; i <= 12; i++) HUB.recordSend(s, ID_A, 201, NOW + i, { title: 'T' + i, body: 'B' + i, at: NOW + i });
  const r = ask(s, { action: 'recent', id: ID_A }).recent;
  assert.deepEqual(r.map((m) => m.title), ['T12', 'T11', 'T10', 'T9', 'T8', 'T7', 'T6', 'T5', 'T4', 'T3']);
  HUB.recordSend(s, ID_A, 201, NOW + 20, { title: 'x'.repeat(500), body: 'y'.repeat(2000), at: NOW + 20 });
  const top = ask(s, { action: 'recent', id: ID_A }).recent[0];
  assert.equal(top.title.length, 120);
  assert.equal(top.body.length, 300);
});

test('recent: a send with no message (an old caller) still records the send and keeps nothing', () => {
  const s = newStore(); sub(s, ID_A);
  assert.equal(HUB.recordSend(s, ID_A, 201, NOW + 1), 'sent');
  assert.deepEqual(ask(s, { action: 'recent', id: ID_A }).recent, []);
});

test('recent: a bad id, or a device that is not signed up, gets nothing back', () => {
  const s = newStore(); sub(s, ID_A);
  HUB.recordSend(s, ID_A, 201, NOW + 1, { title: 'Secret job', body: 'x', at: NOW });
  assert.deepEqual(ask(s, { action: 'recent', id: 'nope' }), { ok: false, error: 'bad id' });
  assert.deepEqual(ask(s, { action: 'recent', id: ID_B }), { ok: false, error: 'not signed up' });
});

test('recent: kept messages do not leak into what the Devices tab or the sender see', () => {
  const s = newStore(); sub(s, ID_A);
  HUB.recordSend(s, ID_A, 201, NOW + 1, { title: 'T', body: 'B', at: NOW });
  assert.equal(JSON.stringify(HUB.records(s)).indexOf('"T"'), -1);
  assert.equal(JSON.stringify(HUB.phones(s)).indexOf('recent'), -1);
});

// ---- 18 Nov cold test (jobtester's iPhone D169): the page said "Notifications are on" while the device was still
// waiting for the owner. The page asks for its Recent list every time it opens, so that answer says so too. ----
test('recent: a device still waiting to be let in is told so; once let in, it is not', () => {
  const s = newStore();
  subOwner(s, ID_A);
  assert.deepEqual(ask(s, { action: 'recent', id: ID_A }, NOW, OWNER), { ok: true, recent: [], waiting: true });
  assert.equal(HUB.letIn(s, ID_A, OWNER), 'let in');
  assert.deepEqual(ask(s, { action: 'recent', id: ID_A }, NOW, OWNER), { ok: true, recent: [] });
});

test('records: only stored phones are listed, never the script\'s other stored things (keys, the page address)', () => {
  const s = newStore();
  ask(s, { action: 'subscribe', id: ID_A, endpoint: FCM, p256dh: P256, auth: AUTH });
  s.set('PFS_PAGE', 'https://x.web.app/'); s.set('vapid_private', 'secret');
  assert.deepEqual(HUB.records(s).map(r => r.id), [ID_A]);
});
