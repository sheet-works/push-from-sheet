'use strict';
// Tests for push.js - builds the signed, EMPTY push request a sheet sends to a push service.
// Run both test files:  node --test
// Rule: written BEFORE push.js and seen to fail first.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PUSH = require(process.env.PUSH || './push.js');

const KEY = 'C9AFA9D845BA75166B5C215767B1D6934E50C3DB36E89B127B8A622B120F6721'; // the public RFC 6979 test key, not a secret
const NOW = 1794800000;
const FCM = 'https://fcm.googleapis.com/fcm/send/abc123:APA91b-_x';
const WHO = 'mailto:test@example.com';

function nodePublic(privHex) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(privHex, 'hex'));
  return ecdh.getPublicKey();
}
function passBody(r) { return JSON.parse(Buffer.from(r.headers.Authorization.split('.')[1], 'base64url')); }

test('audience = the push service address up to the first slash, same as Node works it out', () => {
  for (const e of [FCM,
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABl',
    'https://web.push.apple.com/QGk3xyz',
    'https://wns2-by3p.notify.windows.com/w/?token=abc%2fdef',
    'https://example.com:8443/push/1',
    'https://example.com:443/push/1',
    'https://EXAMPLE.com/Push/1',
    'https://example.com']) {
    assert.equal(PUSH.audienceOf(e), new URL(e).origin, e);
  }
});

test('addresses that are not https are refused', () => {
  for (const bad of ['http://fcm.googleapis.com/fcm/send/x', '', 'fcm.googleapis.com/x', 'https://', 'ftp://example.com/x',
    ' https://fcm.googleapis.com/x', null, undefined, 42, ['https://fcm.googleapis.com/x'],
    'https://fcm.googleapis.com@evil.com/x', 'https://fcm.googleapis.com\\@evil.com/x', 'https://fcm.googleapis.com%40evil.com/x',
    'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:/x', 'https://fcm.googleapis.com:80a/x']) {
    assert.throws(() => PUSH.audienceOf(bad), 'should refuse: ' + bad);
  }
});

test('the request: POST to the same address, a TTL, and nothing else to send (empty push)', () => {
  const r = PUSH.buildRequest(FCM, KEY, WHO, NOW, 60);
  assert.equal(r.url, FCM);
  assert.equal(r.method, 'post');
  assert.equal(r.headers.TTL, '60');
  assert.deepEqual(Object.keys(r).sort(), ['headers', 'method', 'url']);
  assert.deepEqual(Object.keys(r.headers).sort(), ['Authorization', 'TTL']);
});

test('the Authorization line: vapid t=<pass>, k=<public key>, and Node accepts the pass', () => {
  const r = PUSH.buildRequest(FCM, KEY, WHO, NOW, 60);
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(r.headers.Authorization);
  assert.ok(m, r.headers.Authorization);
  const pub = Buffer.from(m[4], 'base64url');
  assert.equal(pub.toString('hex'), nodePublic(KEY).toString('hex'));
  assert.deepEqual(passBody(r), { aud: 'https://fcm.googleapis.com', exp: Math.floor(NOW / 3600) * 3600 + 12 * 3600, sub: WHO });
  const jwk = { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') };
  const ok = crypto.verify('sha256', Buffer.from(m[1] + '.' + m[2]),
    { key: crypto.createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url'));
  assert.equal(ok, true);
});

test('the pass never lasts more than 24 hours (push services refuse longer)', () => {
  const body = passBody(PUSH.buildRequest(FCM, KEY, WHO, NOW, 60));
  assert.ok(body.exp > NOW && body.exp - NOW <= 24 * 3600);
});

test('pushes in the same clock hour carry the very same pass (Apple: do not make a new one more than once an hour)', () => {
  const hour = Math.floor(NOW / 3600) * 3600;
  const a = PUSH.buildRequest(FCM, KEY, WHO, hour, 60).headers.Authorization;
  const b = PUSH.buildRequest(FCM, KEY, WHO, hour + 1, 60).headers.Authorization;
  const c = PUSH.buildRequest(FCM, KEY, WHO, hour + 3599, 60).headers.Authorization;
  const next = PUSH.buildRequest(FCM, KEY, WHO, hour + 3600, 60).headers.Authorization;
  assert.equal(a, b);
  assert.equal(a, c);
  assert.notEqual(a, next);
  for (const t of [hour, hour + 3599]) {
    const left = passBody(PUSH.buildRequest(FCM, KEY, WHO, t, 60)).exp - t;
    assert.ok(left > 11 * 3600 - 1 && left <= 12 * 3600, 'between 11 and 12 hours left, got ' + left);
  }
});

test('the pass is made out to the service the push is going to', () => {
  const r = PUSH.buildRequest('https://updates.push.services.mozilla.com/wpush/v2/gAAA', KEY, WHO, NOW, 60);
  assert.equal(passBody(r).aud, 'https://updates.push.services.mozilla.com');
});

test('the contact must be mailto: or https:', () => {
  assert.throws(() => PUSH.buildRequest(FCM, KEY, 'test@example.com', NOW, 60));
  assert.throws(() => PUSH.buildRequest(FCM, KEY, '', NOW, 60));
  assert.throws(() => PUSH.buildRequest(FCM, KEY, 'mailto:', NOW, 60), 'mailto: with nothing after it');
  assert.throws(() => PUSH.buildRequest(FCM, KEY, 'https://', NOW, 60), 'https:// with nothing after it');
  assert.doesNotThrow(() => PUSH.buildRequest(FCM, KEY, 'https://example.com/contact', NOW, 60));
});

test('TTL must be a whole number of seconds, zero or more; the time must be in seconds', () => {
  assert.throws(() => PUSH.buildRequest(FCM, KEY, WHO, NOW, -1));
  assert.throws(() => PUSH.buildRequest(FCM, KEY, WHO, NOW, 1.5));
  assert.throws(() => PUSH.buildRequest(FCM, KEY, WHO, NOW, '60'));
  assert.throws(() => PUSH.buildRequest(FCM, KEY, WHO, NOW, Infinity));
  assert.throws(() => PUSH.buildRequest(FCM, KEY, WHO, 'now', 60));
  assert.throws(() => PUSH.buildRequest(FCM, KEY, WHO, String(NOW), 60), 'the time given as text');
  assert.throws(() => PUSH.buildRequest(FCM, KEY, WHO, NOW * 1000, 60), 'milliseconds given instead of seconds');
  assert.equal(PUSH.buildRequest(FCM, KEY, WHO, NOW, 0).headers.TTL, '0');
});

test('urgency: left out unless asked for; high tells the push service to wake a sleeping phone', () => {
  assert.equal('Urgency' in PUSH.buildRequest(FCM, KEY, WHO, NOW, 60).headers, false);
  for (const u of ['very-low', 'low', 'normal', 'high']) {
    const r = PUSH.buildRequest(FCM, KEY, WHO, NOW, 60, u);
    assert.equal(r.headers.Urgency, u);
    assert.deepEqual(Object.keys(r.headers).sort(), ['Authorization', 'TTL', 'Urgency']);
  }
});

test('an urgency that is not one of the four allowed words is refused', () => {
  for (const bad of ['HIGH', 'urgent', '', 'high ', 5, null, true, ['high']]) {
    assert.throws(() => PUSH.buildRequest(FCM, KEY, WHO, NOW, 60, bad), /Urgency must be/, String(bad));
  }
});

test('no big-number literals in push.js either (Apps Script refuses to save them)', () => {
  const src = require('node:fs').readFileSync(require.resolve(process.env.PUSH || './push.js'), 'utf8');
  assert.deepEqual(src.match(/\b(0x[0-9A-Fa-f]+|\d+)n\b/g) || [], []);
});

// ---- 17 Nov: a push that CARRIES locked words (body from lock.js) ----
const LOCKED = Array.from({ length: 150 }, (_, i) => (i * 37) % 256);

test('a push with a body says it is aes128gcm and hands UrlFetchApp the bytes the way it wants them (-128 to 127)', () => {
  const r = PUSH.buildRequest(FCM, KEY, WHO, NOW, 60, 'high', LOCKED);
  assert.deepEqual(Object.keys(r).sort(), ['headers', 'method', 'payload', 'url']);
  assert.equal(r.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(r.headers['Content-Type'], 'application/octet-stream');
  assert.equal(r.headers.Urgency, 'high');
  assert.equal(r.payload.length, 150);
  assert.deepEqual(r.payload.map((v) => v < 0 ? v + 256 : v), LOCKED);
  assert.ok(r.payload.every((v) => v >= -128 && v <= 127));
});

test('a push with no body is still the plain empty push', () => {
  for (const none of [undefined, null]) {
    const r = PUSH.buildRequest(FCM, KEY, WHO, NOW, 60, 'high', none);
    assert.deepEqual(Object.keys(r).sort(), ['headers', 'method', 'url']);
    assert.equal(r.headers['Content-Encoding'], undefined);
  }
});

test('a body that is not bytes, is empty, or is over 4096 bytes is refused', () => {
  for (const bad of [[], 'text', [1, 256], [1, -1], [1.5], new Array(4097).fill(1), { length: 3 }]) {
    assert.throws(() => PUSH.buildRequest(FCM, KEY, WHO, NOW, 60, 'high', bad), /body/i, JSON.stringify(bad).slice(0, 30));
  }
  assert.equal(PUSH.buildRequest(FCM, KEY, WHO, NOW, 60, 'high', new Array(4096).fill(1)).payload.length, 4096);
});

test('the words to lock: Apple\'s declarative shape, with a tag made from the message time', () => {
  const text = PUSH.message('New job', 'Dave Miller', 1794800000123, 'https://demo.web.app/');
  assert.deepEqual(JSON.parse(text), { web_push: 8030, notification: { title: 'New job', body: 'Dave Miller', navigate: 'https://demo.web.app/', tag: 'push-from-sheet-1794800000123' } });
});

test('the words to lock refuse an empty title, a non-https address or a bad time', () => {
  assert.throws(() => PUSH.message('', 'x', 1, 'https://a.web.app/'), /title/i);
  assert.throws(() => PUSH.message(5, 'x', 1, 'https://a.web.app/'), /title/i);
  assert.throws(() => PUSH.message('t', 7, 1, 'https://a.web.app/'), /message/i);
  for (const bad of ['http://a.web.app/', 'javascript:alert(1)', '', undefined]) assert.throws(() => PUSH.message('t', 'x', 1, bad), /address/i, String(bad));
  for (const bad of [NaN, '1', undefined, Infinity]) assert.throws(() => PUSH.message('t', 'x', bad, 'https://a.web.app/'), /time/i, String(bad));
});
