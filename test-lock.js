'use strict';
// Tests for lock.js - locks the words of a push so only one phone can read them (RFC 8291, "aes128gcm").
// Run:  node --test test-lock.js
// Rule: written BEFORE lock.js and seen to fail first.
// Three referees, none of them ours: the worked example printed in RFC 8291, the AES answer printed in FIPS-197,
// and Node's own crypto playing the phone (it unlocks what we lock).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const LOCK = require(process.env.LOCK || './lock.js');
const E = require(process.env.ES256 || './es256.js');

const hex = b => Buffer.from(b).toString('hex');
const unhex = h => Array.from(Buffer.from(h, 'hex'));
const b64 = s => Array.from(Buffer.from(s.replace(/\s+/g, ''), 'base64url'));
const b64hex = s => hex(b64(s));
// Repeatable "random" bytes, so a failing test fails the same way every run.
function bytes(seed, n) {
  let out = Buffer.alloc(0), i = 0;
  while (out.length < n) out = Buffer.concat([out, crypto.createHash('sha256').update(seed + ':' + (i++)).digest()]);
  return Array.from(out.subarray(0, n));
}

// ---------------- the AES block (FIPS-197) ----------------
test('AES: the worked example printed in FIPS-197 (Appendix C.1)', () => {
  const out = LOCK.aesBlock(unhex('000102030405060708090a0b0c0d0e0f'), unhex('00112233445566778899aabbccddeeff'));
  assert.equal(hex(out), '69c4e0d86a7b0430d8cdb78070b4c55a');
});

test('AES: 40 keys and blocks give the same answer as Node', () => {
  for (let i = 0; i < 40; i++) {
    const key = bytes('k' + i, 16), block = bytes('b' + i, 16);
    const c = crypto.createCipheriv('aes-128-ecb', Buffer.from(key), null); c.setAutoPadding(false);
    const want = Buffer.concat([c.update(Buffer.from(block)), c.final()]).toString('hex');
    assert.equal(hex(LOCK.aesBlock(key, block)), want, 'case ' + i);
  }
});

// ---------------- AES-GCM ----------------
function nodeGcm(key, nonce, plain) {
  const c = crypto.createCipheriv('aes-128-gcm', Buffer.from(key), Buffer.from(nonce));
  return Buffer.concat([c.update(Buffer.from(plain)), c.final(), c.getAuthTag()]).toString('hex');
}

test('GCM: the first two test cases printed in the GCM specification', () => {
  const zero16 = new Array(16).fill(0), zero12 = new Array(12).fill(0);
  assert.equal(hex(LOCK.gcm(zero16, zero12, [])), '58e2fccefa7e3061367f1d57a4e7455a');
  assert.equal(hex(LOCK.gcm(zero16, zero12, zero16)), '0388dace60b6a392f328c2b971b2fe78' + 'ab6e47d42cec13bdf53a67b21257bddf');
  // and Node agrees those printed answers are right
  assert.equal(nodeGcm(zero16, zero12, []), '58e2fccefa7e3061367f1d57a4e7455a');
  assert.equal(nodeGcm(zero16, zero12, zero16), '0388dace60b6a392f328c2b971b2fe78' + 'ab6e47d42cec13bdf53a67b21257bddf');
});

test('GCM: every length from 0 to 70 bytes, and some long ones, match Node', () => {
  const lengths = []; for (let n = 0; n <= 70; n++) lengths.push(n);
  lengths.push(255, 256, 257, 600, 3994);
  for (const n of lengths) {
    const key = bytes('gk' + n, 16), nonce = bytes('gn' + n, 12), plain = bytes('gp' + n, n);
    assert.equal(hex(LOCK.gcm(key, nonce, plain)), nodeGcm(key, nonce, plain), 'length ' + n);
  }
});

test('GCM: a key or nonce of the wrong size is refused', () => {
  assert.throws(() => LOCK.gcm(new Array(15).fill(0), new Array(12).fill(0), []), /key/i);
  assert.throws(() => LOCK.gcm(new Array(16).fill(0), new Array(11).fill(0), []), /nonce/i);
  assert.throws(() => LOCK.gcm(new Array(16).fill(0), new Array(13).fill(0), []), /nonce/i);
});

// ---------------- the worked example in RFC 8291 (section 5 and Appendix A) ----------------
const RFC = {
  plain: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV- JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  ecdh: 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs',
  prkKey: 'Snr3JMxaHVDXHWJn5wdC52WjpCtd2EIEGBykDcZW32k',
  keyInfo: 'V2ViUHVzaDogaW5mbwAEJXGyvs3942BVG q8e0PTNNmwR zr5VX4m8t7GGpTM5FzFo7OLr4BhZe9MEebhuPI-OztV3 ylkYfpJGmQ22ggCLDgT-M_SrDepxkU21WCP3O1SUj0Ew bZIHMtu5pZpTKGSCIA5Zent7wmC6HCJ5mFgJkuk5cwAv MBKiiujwa7t45ewP',
  ikm: 'S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg',
  prk: '09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc',
  cek: 'oIhVW04MRdy2XN9CiKLxTg',
  nonce: '4h_95klXJ5E_qnoN',
  header: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8',
  cipher: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs bI_0LpXMuGvnzQ',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'
};
const clean = s => s.replace(/\s+/g, '');
const rfcArgs = () => [b64(RFC.plain), clean(RFC.uaPublic), RFC.auth, hex(b64(RFC.asPrivate)), b64(RFC.salt)];

test('RFC 8291: the example plaintext really is the watermelon sentence', () => {
  assert.equal(Buffer.from(b64(RFC.plain)).toString('utf8'), 'When I grow up, I want to be a watermelon');
});

test('RFC 8291: every in-between value matches the worked example', () => {
  const w = LOCK.workings.apply(null, rfcArgs());
  assert.equal(hex(w.asPublic), b64hex(RFC.asPublic), 'sender public key');
  assert.equal(hex(w.ecdh), b64hex(RFC.ecdh), 'shared secret');
  assert.equal(hex(w.prkKey), b64hex(RFC.prkKey), 'PRK_key');
  assert.equal(hex(w.keyInfo), b64hex(RFC.keyInfo), 'key_info');
  assert.equal(hex(w.ikm), b64hex(RFC.ikm), 'IKM');
  assert.equal(hex(w.prk), b64hex(RFC.prk), 'PRK');
  assert.equal(hex(w.cek), b64hex(RFC.cek), 'CEK');
  assert.equal(hex(w.nonce), b64hex(RFC.nonce), 'NONCE');
  assert.equal(hex(w.header), b64hex(RFC.header), 'the 86-byte header');
  assert.equal(hex(w.body.slice(86)), b64hex(RFC.cipher), 'the locked words');
});

test('RFC 8291: the finished message is byte-for-byte the one printed in section 5', () => {
  const body = LOCK.seal.apply(null, rfcArgs());
  // The RFC's example says "Content-Length: 145", but the body it prints is 144 bytes (86 header + 41 words + 1 mark + 16 tag).
  // The printed bytes are the referee, not that header line.
  assert.equal(b64(RFC.body).length, 144);
  assert.equal(body.length, 144);
  assert.equal(hex(body), b64hex(RFC.body));
});

// ---------------- Node plays the phone ----------------
// Nothing of ours is used to unlock: Node's own ECDH, HKDF and AES-GCM, following the receiver's side of RFC 8291.
function nodeOpen(bodyBytes, uaPrivate, uaPublic, auth) {
  const body = Buffer.from(bodyBytes);
  const salt = body.subarray(0, 16), idLen = body[20];
  const asPublic = body.subarray(21, 21 + idLen), sealed = body.subarray(21 + idLen);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(Buffer.from(uaPrivate));
  const secret = ecdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), Buffer.from(uaPublic), asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, Buffer.from(auth), info, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(sealed.subarray(sealed.length - 16));
  const plain = Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]); // throws if tampered or wrong
  return { rs: body.readUInt32BE(16), idLen, asPublic, plain };
}
function phone(seed) { // a pretend phone: its own key pair and secret, made by Node
  const ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(Buffer.from(bytes('ua' + seed, 32)));
  const pub = ecdh.getPublicKey();
  const auth = bytes('auth' + seed, 16);
  return { priv: ecdh.getPrivateKey(), pub, p256dh: pub.toString('base64url'), auth, authText: Buffer.from(auth).toString('base64url') };
}

test('Node unlocks the RFC example with the phone key printed there', () => {
  const got = nodeOpen(LOCK.seal.apply(null, rfcArgs()), b64(RFC.uaPrivate), b64(RFC.uaPublic), b64(RFC.auth));
  assert.equal(got.plain.toString('utf8'), 'When I grow up, I want to be a watermelon\u0002');
  assert.equal(got.rs, 4096);
  assert.equal(got.idLen, 65);
});

test('Node, playing 25 different phones, unlocks what we lock - plain and non-English words alike', () => {
  const words = ['New job', '', 'x', '12 Smith St, 7am Tuesday - core drilling', 'Zażółć gęślą jaźń', '日本語のテスト', 'emoji 🚧🔔', 'a'.repeat(600)];
  for (let i = 0; i < 25; i++) {
    const ph = phone(i), text = JSON.stringify({ title: words[i % words.length], n: i });
    const plain = E.utf8(text), eph = hex(bytes('eph' + i, 32)), salt = bytes('salt' + i, 16);
    const body = LOCK.seal(plain, ph.p256dh, ph.authText, eph, salt);
    const got = nodeOpen(body, ph.priv, ph.pub, ph.auth);
    assert.equal(got.plain.subarray(0, got.plain.length - 1).toString('utf8'), text, 'phone ' + i);
    assert.equal(got.plain[got.plain.length - 1], 2, 'ends with the last-record mark');
    assert.equal(hex(got.asPublic), hex(E.publicKey(eph)), 'carries the sender public key');
    assert.equal(hex(body.slice(0, 16)), hex(salt), 'starts with the salt');
    assert.equal(body.length, 86 + plain.length + 1 + 16);
  }
});

test('the wrong phone cannot unlock it, and neither can the right phone with the wrong secret', () => {
  const a = phone('a'), b = phone('b');
  const body = LOCK.seal(E.utf8('private'), a.p256dh, a.authText, hex(bytes('e', 32)), bytes('s', 16));
  assert.equal(nodeOpen(body, a.priv, a.pub, a.auth).plain.toString(), 'private\u0002');
  assert.throws(() => nodeOpen(body, b.priv, b.pub, b.auth));
  assert.throws(() => nodeOpen(body, a.priv, a.pub, b.auth));
});

test('the same inputs always give the same message; a new salt or a new sender key gives a different one', () => {
  const ph = phone(1), plain = E.utf8('same'), eph = hex(bytes('e1', 32)), salt = bytes('s1', 16);
  const one = hex(LOCK.seal(plain, ph.p256dh, ph.authText, eph, salt));
  assert.equal(hex(LOCK.seal(plain, ph.p256dh, ph.authText, eph, salt)), one);
  assert.notEqual(hex(LOCK.seal(plain, ph.p256dh, ph.authText, eph, bytes('s2', 16))).slice(32), one.slice(32));
  assert.notEqual(hex(LOCK.seal(plain, ph.p256dh, ph.authText, hex(bytes('e2', 32)), salt)), one);
});

test('the longest message a push service must take (3993 bytes) is locked; one byte more is refused', () => {
  const ph = phone(2), eph = hex(bytes('e', 32)), salt = bytes('s', 16);
  const body = LOCK.seal(bytes('long', 3993), ph.p256dh, ph.authText, eph, salt);
  assert.equal(body.length, 4096);
  assert.equal(hex(nodeOpen(body, ph.priv, ph.pub, ph.auth).plain.subarray(0, 3993)), hex(bytes('long', 3993)));
  assert.throws(() => LOCK.seal(bytes('long', 3994), ph.p256dh, ph.authText, eph, salt), /too long/i);
});

// ---------------- refusing bad input ----------------
const GOOD = () => { const ph = phone(3); return [E.utf8('hi'), ph.p256dh, ph.authText, hex(bytes('e', 32)), bytes('s', 16)]; };
const withArg = (i, v) => { const a = GOOD(); a[i] = v; return a; };

test('a phone key that is not a real point on the curve is refused', () => {
  const ph = phone(3), pub = Array.from(ph.pub);
  const flip = (i) => { const p = pub.slice(); p[i] ^= 1; return Buffer.from(p).toString('base64url'); };
  assert.throws(() => LOCK.seal.apply(null, withArg(1, flip(64))), /phone key/i);   // last byte of Y changed
  assert.throws(() => LOCK.seal.apply(null, withArg(1, flip(10))), /phone key/i);   // a byte of X changed
  const zeros = Buffer.from([4].concat(new Array(64).fill(0))).toString('base64url');
  assert.throws(() => LOCK.seal.apply(null, withArg(1, zeros)), /phone key/i);
});

test('a phone key of the wrong length, the wrong first byte or odd letters is refused', () => {
  const ph = phone(3), pub = Array.from(ph.pub);
  const t = (arr) => Buffer.from(arr).toString('base64url');
  for (const bad of [t(pub.slice(0, 64)), t(pub.concat([0])), t([3].concat(pub.slice(1))), t([2].concat(pub.slice(1, 33))),
    ph.p256dh.slice(0, 86) + '+', ph.p256dh.slice(0, 86) + '=', '', undefined, 12345]) {
    assert.throws(() => LOCK.seal.apply(null, withArg(1, bad)), /phone key/i, String(bad).slice(0, 12));
  }
});

test('a phone key whose numbers are not below the curve prime is refused, even though it "wraps round" to a real point', () => {
  // Find a real point with a tiny x, then add the prime P to x: the sums still fit in 32 bytes and, reduced, land on the curve.
  const P = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFFn;
  const B = 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604Bn;
  const pow = (b, e) => { let r = 1n; b %= P; while (e > 0n) { if (e & 1n) r = r * b % P; b = b * b % P; e >>= 1n; } return r; };
  let x = 0n, y;
  for (;; x++) { const rhs = ((x * x * x - 3n * x + B) % P + P) % P; y = pow(rhs, (P + 1n) / 4n); if (y * y % P === rhs) break; }
  const b32 = (n) => Array.from(Buffer.from(n.toString(16).padStart(64, '0'), 'hex'));
  const real = Buffer.from([4].concat(b32(x), b32(y))).toString('base64url');
  const wrapped = Buffer.from([4].concat(b32(x + P), b32(y))).toString('base64url');
  assert.doesNotThrow(() => LOCK.seal.apply(null, withArg(1, real)));           // the honest point is fine
  assert.throws(() => LOCK.seal.apply(null, withArg(1, wrapped)), /phone key/i); // the wrapped one is not
});

test('a phone secret that is not 16 bytes is refused', () => {
  for (const bad of [Buffer.alloc(15).toString('base64url'), Buffer.alloc(17).toString('base64url'), '', 'q'.repeat(21) + '+', undefined]) {
    assert.throws(() => LOCK.seal.apply(null, withArg(2, bad)), /phone secret/i, String(bad));
  }
});

test('a bad sender key or salt is refused', () => {
  for (const bad of ['', '00'.repeat(32), 'ff'.repeat(32), 'ab'.repeat(31), undefined]) {
    assert.throws(() => LOCK.seal.apply(null, withArg(3, bad)), /key/i, String(bad));
  }
  for (const bad of [bytes('s', 15), bytes('s', 17), [], undefined, bytes('s', 15).concat([256]), bytes('s', 15).concat([-1]), bytes('s', 15).concat([1.5])]) {
    assert.throws(() => LOCK.seal.apply(null, withArg(4, bad)), /salt/i, String(bad).slice(0, 20));
  }
});

test('words that are not a list of bytes are refused', () => {
  for (const bad of ['text', undefined, [1, 2, 256], [1, -1], [1.5]]) {
    assert.throws(() => LOCK.seal.apply(null, withArg(0, bad)), /bytes/i, String(bad));
  }
});

// ---------------- the small helpers ----------------
test('web-safe base64 goes there and back, at every length', () => {
  for (let n = 0; n <= 40; n++) {
    const b = bytes('r' + n, n);
    assert.equal(hex(LOCK.fromB64url(E.b64url(b))), hex(b), 'length ' + n);
    assert.equal(E.b64url(b), Buffer.from(b).toString('base64url'));
  }
  for (const bad of ['a', 'ab+d', 'ab/d', 'ab=d', 'ab d', 'abcde']) assert.throws(() => LOCK.fromB64url(bad), /base64/i, bad);
});

test('random salt and sender key are built from the bytes the caller hands in (the script supplies real randomness)', () => {
  const r = LOCK.fresh(bytes('rnd', 64));
  assert.equal(r.salt.length, 16);
  assert.match(r.ephPrivHex, /^[0-9a-f]{64}$/);
  assert.equal(hex(r.salt), hex(bytes('rnd', 64).slice(0, 16)));
  // the key comes from the other 48 bytes, squeezed into the allowed range, never zero
  const N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n;
  const want = (BigInt('0x' + hex(bytes('rnd', 64).slice(16))) % (N - 1n)) + 1n;
  assert.equal(BigInt('0x' + r.ephPrivHex), want);
  assert.equal(LOCK.fresh(new Array(64).fill(0)).ephPrivHex, '0'.repeat(63) + '1');
  for (const bad of [bytes('rnd', 63), bytes('rnd', 65), undefined, 'x'.repeat(64)]) assert.throws(() => LOCK.fresh(bad), /64 random bytes/i);
});
