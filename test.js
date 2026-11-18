'use strict';
// Tests for es256.js - the signer a Google Sheet needs to send Web Push.
// Run:  node --test test.js
// Rule: these were written BEFORE the signer and seen to fail first.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const E = require(process.env.ES256 || './es256.js');

// The size of the P-256 group, typed here from the standard so the tests do not lean on our file for it.
const N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n;

const HEX = b => Buffer.from(b).toString('hex').toUpperCase();
const bytes = s => Array.from(Buffer.from(s, 'utf8'));

// Node works the public key out by itself, from the private key only.
// Nothing of ours is used here, so Node is an independent referee.
function nodePublicKey(privHex) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(privHex, 'hex'));
  const pub = ecdh.getPublicKey(); // 65 bytes: 04 | X | Y
  const jwk = { kty: 'EC', crv: 'P-256',
    x: pub.subarray(1, 33).toString('base64url'),
    y: pub.subarray(33, 65).toString('base64url') };
  return { raw: pub, key: crypto.createPublicKey({ key: jwk, format: 'jwk' }) };
}
function nodeAccepts(privHex, msgBytes, sigBytes) {
  return crypto.verify('sha256', Buffer.from(msgBytes),
    { key: nodePublicKey(privHex).key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sigBytes));
}

// ---- The published answer: RFC 6979, appendix A.2.5 (curve P-256, SHA-256) ----
const RFC_KEY = 'C9AFA9D845BA75166B5C215767B1D6934E50C3DB36E89B127B8A622B120F6721';
const RFC_PUB_X = '60FED4BA255A9D31C961EB74C6356D68C049B8923B61FA6CE669622E60F29FB6';
const RFC_PUB_Y = '7903FE1008B8BC99A41AE9E95628BC64F2F1B20C2D7E9F5177A3C294D4462299';

test('RFC 6979 published answer for the message "sample"', () => {
  const sig = E.sign(RFC_KEY, bytes('sample'));
  assert.equal(HEX(sig.slice(0, 32)), 'EFD48B2AACB6A8FD1140DD9CD45E81D69D2C877B56AAF991C34D0EA84EAF3716');
  assert.equal(HEX(sig.slice(32)), 'F7CB1C942D657C41D436C7A1B6E29F65F3E900DBB9AFF4064DC4AB2F843ACDA8');
});

test('RFC 6979 published answer for the message "test"', () => {
  const sig = E.sign(RFC_KEY, bytes('test'));
  assert.equal(HEX(sig.slice(0, 32)), 'F1ABB023518351CD71D881567B1EA663ED3EFCF6C5132B354F28D3B0B7D38367');
  assert.equal(HEX(sig.slice(32)), '019F4113742A2B14BD25926B49C649155F267E60D3814B4C0CC84250E46F0083');
});

test('public key matches the RFC and Node, in the 65-byte form browsers want', () => {
  const pub = E.publicKey(RFC_KEY);
  assert.equal(pub.length, 65);
  assert.equal(pub[0], 4);
  assert.equal(HEX(pub.slice(1, 33)), RFC_PUB_X);
  assert.equal(HEX(pub.slice(33)), RFC_PUB_Y);
  assert.equal(HEX(pub), HEX(nodePublicKey(RFC_KEY).raw));
});

test('Node accepts our signature on the RFC messages', () => {
  for (const m of ['sample', 'test']) {
    assert.equal(nodeAccepts(RFC_KEY, bytes(m), E.sign(RFC_KEY, bytes(m))), true);
  }
});

test('Node rejects our signature if the message is changed', () => {
  const sig = E.sign(RFC_KEY, bytes('sample'));
  assert.equal(nodeAccepts(RFC_KEY, bytes('sampla'), sig), false);
});

test('40 random keys, messages of every awkward length: Node accepts all, public keys match', () => {
  const lengths = [0, 1, 31, 32, 33, 55, 56, 63, 64, 65, 127, 128, 500, 5000];
  for (let i = 0; i < 40; i++) {
    let priv;
    do { priv = crypto.randomBytes(32).toString('hex'); }
    while (BigInt('0x' + priv) === 0n || BigInt('0x' + priv) >= N);
    const msg = Array.from(crypto.randomBytes(lengths[i % lengths.length]));
    const sig = E.sign(priv, msg);
    assert.equal(sig.length, 64);
    assert.equal(nodeAccepts(priv, msg, sig), true, 'key ' + priv);
    assert.equal(HEX(E.publicKey(priv)), HEX(nodePublicKey(priv).raw), 'key ' + priv);
  }
});

test('edge keys: 1, 2, and the biggest allowed key', () => {
  const biggest = (N - 1n).toString(16).padStart(64, '0');
  for (const priv of ['1'.padStart(64, '0'), '2'.padStart(64, '0'), biggest]) {
    const sig = E.sign(priv, bytes('edge'));
    assert.equal(nodeAccepts(priv, bytes('edge'), sig), true, 'key ' + priv);
    assert.equal(HEX(E.publicKey(priv)), HEX(nodePublicKey(priv).raw));
  }
});

test('1500 signatures are all exactly 64 bytes (catches a dropped leading zero) and Node accepts all', () => {
  let sawLeadingZero = false;
  for (let i = 0; i < 1500; i++) {
    const msg = bytes('job ' + i);
    const sig = E.sign(RFC_KEY, msg);
    assert.equal(sig.length, 64, 'message ' + i);
    if (sig[0] === 0 || sig[32] === 0) sawLeadingZero = true;
    assert.equal(nodeAccepts(RFC_KEY, msg, sig), true, 'message ' + i);
  }
  assert.equal(sawLeadingZero, true, 'the run never met a leading zero, so it proved nothing - add more messages');
});

test('our file agrees on the group size', () => {
  assert.equal(E.N, N);
});

test('same input always gives the same signature', () => {
  assert.equal(HEX(E.sign(RFC_KEY, bytes('again'))), HEX(E.sign(RFC_KEY, bytes('again'))));
});

test('bad private keys are refused, not signed with', () => {
  assert.throws(() => E.sign('0'.repeat(64), bytes('x')));
  assert.throws(() => E.sign(N.toString(16), bytes('x')));          // equal to N: too big
  assert.throws(() => E.sign('F'.repeat(64), bytes('x')));            // bigger than N
  assert.throws(() => E.sign('ABCD', bytes('x')));                    // too short
  assert.throws(() => E.sign('Z'.repeat(64), bytes('x')));            // not hex
});

test('base64url: web-safe letters, no padding, matches Node', () => {
  assert.equal(E.b64url([251, 255, 254]), '-__-');
  for (const len of [0, 1, 2, 3, 4, 5, 64, 65]) {
    const b = crypto.randomBytes(len);
    assert.equal(E.b64url(Array.from(b)), b.toString('base64url'));
  }
});

test('the VAPID pass (JWT): right fields, and Node accepts it as a real ES256 token', () => {
  const jwt = E.vapidJwt(RFC_KEY, 'https://fcm.googleapis.com', 'mailto:test@example.com', 1800000000);
  const parts = jwt.split('.');
  assert.equal(parts.length, 3);
  assert.deepEqual(JSON.parse(Buffer.from(parts[0], 'base64url')), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(Buffer.from(parts[1], 'base64url')),
    { aud: 'https://fcm.googleapis.com', exp: 1800000000, sub: 'mailto:test@example.com' });
  const sig = Buffer.from(parts[2], 'base64url');
  assert.equal(sig.length, 64);
  assert.equal(nodeAccepts(RFC_KEY, bytes(parts[0] + '.' + parts[1]), Array.from(sig)), true);
  assert.equal(/[+\/=]/.test(jwt), false);
});

test('the VAPID pass survives a non-English letter in the contact', () => {
  const jwt = E.vapidJwt(RFC_KEY, 'https://example.com', 'mailto:josé@example.com', 1800000000);
  const parts = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).sub, 'mailto:josé@example.com');
  assert.equal(nodeAccepts(RFC_KEY, bytes(parts[0] + '.' + parts[1]), Array.from(Buffer.from(parts[2], 'base64url'))), true);
});

test('no big-number literals like 123n in the file (Apps Script refuses to SAVE them - seen 16 Nov 2026)', () => {
  const src = require('node:fs').readFileSync(require.resolve(process.env.ES256 || './es256.js'), 'utf8');
  const hits = src.match(/\b(0x[0-9A-Fa-f]+|\d+)n\b/g) || [];
  assert.deepEqual(hits, []);
});
