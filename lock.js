// lock.js - locks the words of a push so that only the one phone it is sent to can read them.
// This is the Web Push message encryption standard: RFC 8291, carried as "aes128gcm" (RFC 8188).
// Why: a push may only carry words if they are locked this way. With the words inside the push the
// phone shows them at once and never has to call back to the sheet for them.
// Needs es256.js (the same curve maths the signer uses). Runs in Apps Script and in Node (for the tests).
// Written from the standards (RFC 8291, RFC 8188, FIPS-197 for AES, NIST SP 800-38D for GCM) and proven
// against the worked example printed in RFC 8291 and against Node's own crypto. No code copied from anyone.
// It never makes random numbers itself: the caller hands in the salt and a one-off sender key (see fresh()).

if (typeof module !== 'undefined' && typeof ES256 === 'undefined') { var ES256 = require(process.env.ES256 || './es256.js'); }

var LOCK = (function () {
  'use strict';

  var MAX_WORDS = 3993;  // RFC 8291 section 4: the most a push service has to accept, less the header, the mark and the tag
  var RECORD_SIZE = [0, 0, 16, 0]; // 4096, as four bytes

  // ---- small helpers ----
  function isBytes(b) {
    if (!Array.isArray(b)) return false;
    for (var i = 0; i < b.length; i++) { if (typeof b[i] !== 'number' || b[i] < 0 || b[i] > 255 || Math.floor(b[i]) !== b[i]) return false; }
    return true;
  }
  function xorInto(a, b) { for (var i = 0; i < 16; i++) a[i] ^= b[i]; return a; }
  function zeros(n) { var z = []; for (var i = 0; i < n; i++) z.push(0); return z; }

  // Web-safe base64 (the letters a browser uses for its keys) back into bytes.
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function fromB64url(s) {
    if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error('Not web-safe base64');
    var out = [];
    for (var i = 0; i < s.length; i += 4) {
      var c0 = B64.indexOf(s[i]), c1 = B64.indexOf(s[i + 1]);
      var c2 = i + 2 < s.length ? B64.indexOf(s[i + 2]) : -1, c3 = i + 3 < s.length ? B64.indexOf(s[i + 3]) : -1;
      out.push(((c0 << 2) | (c1 >> 4)) & 255);
      if (c2 >= 0) out.push(((c1 << 4) | (c2 >> 2)) & 255);
      if (c3 >= 0) out.push(((c2 << 6) | c3) & 255);
    }
    return out;
  }

  // ---- AES-128, one 16-byte block (FIPS-197) ----
  // The substitution table is worked out when the file loads rather than typed in (256 numbers are easy to mistype).
  var SBOX = (function () {
    var box = zeros(256), p = 1, q = 1;
    function rotl(x, n) { return ((x << n) | (x >> (8 - n))) & 255; }
    do {
      p = (p ^ (p << 1) ^ ((p & 128) ? 0x1b : 0)) & 255;            // p times 3
      q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 255;               // q divided by 3
      if (q & 128) q ^= 0x09;
      box[p] = (q ^ rotl(q, 1) ^ rotl(q, 2) ^ rotl(q, 3) ^ rotl(q, 4) ^ 0x63) & 255;
    } while (p !== 1);
    box[0] = 0x63;
    return box;
  })();
  var RCON = [1, 2, 4, 8, 16, 32, 64, 128, 27, 54];
  function xtime(a) { return ((a << 1) ^ ((a & 128) ? 0x1b : 0)) & 255; }

  // The 16-byte key stretched into 11 round keys (176 bytes).
  function expandKey(key) {
    var w = key.slice();
    for (var i = 16; i < 176; i += 4) {
      var t = [w[i - 4], w[i - 3], w[i - 2], w[i - 1]];
      if (i % 16 === 0) t = [SBOX[t[1]] ^ RCON[i / 16 - 1], SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]];
      for (var j = 0; j < 4; j++) w.push(w[i - 16 + j] ^ t[j]);
    }
    return w;
  }
  function encryptBlock(block, w) {
    var s = [], i, c, round;
    for (i = 0; i < 16; i++) s.push(block[i] ^ w[i]);
    for (round = 1; round <= 10; round++) {
      var t = [];
      for (c = 0; c < 4; c++) {            // substitute, and shift row r left by r, in one go
        t[4 * c] = SBOX[s[4 * c]];
        t[4 * c + 1] = SBOX[s[4 * ((c + 1) % 4) + 1]];
        t[4 * c + 2] = SBOX[s[4 * ((c + 2) % 4) + 2]];
        t[4 * c + 3] = SBOX[s[4 * ((c + 3) % 4) + 3]];
      }
      if (round < 10) {                    // mix each column (not in the last round)
        for (c = 0; c < 4; c++) {
          var a0 = t[4 * c], a1 = t[4 * c + 1], a2 = t[4 * c + 2], a3 = t[4 * c + 3];
          t[4 * c] = xtime(a0) ^ xtime(a1) ^ a1 ^ a2 ^ a3;
          t[4 * c + 1] = a0 ^ xtime(a1) ^ xtime(a2) ^ a2 ^ a3;
          t[4 * c + 2] = a0 ^ a1 ^ xtime(a2) ^ xtime(a3) ^ a3;
          t[4 * c + 3] = xtime(a0) ^ a0 ^ a1 ^ a2 ^ xtime(a3);
        }
      }
      for (i = 0; i < 16; i++) s[i] = t[i] ^ w[16 * round + i];
    }
    return s;
  }
  function aesBlock(key, block) {
    if (!isBytes(key) || key.length !== 16) throw new Error('The AES key must be 16 bytes');
    if (!isBytes(block) || block.length !== 16) throw new Error('The AES block must be 16 bytes');
    return encryptBlock(block, expandKey(key));
  }

  // ---- AES-GCM (NIST SP 800-38D) with a 12-byte nonce and no extra data: gives the locked bytes, then a 16-byte tag ----
  function gmul(X, Y) { // multiply two 16-byte blocks the GCM way
    var Z = zeros(16), V = Y.slice();
    for (var i = 0; i < 128; i++) {
      if ((X[i >> 3] >> (7 - (i & 7))) & 1) xorInto(Z, V);
      var low = V[15] & 1;
      for (var j = 15; j > 0; j--) V[j] = (V[j] >> 1) | ((V[j - 1] & 1) << 7);
      V[0] >>= 1;
      if (low) V[0] ^= 0xe1;
    }
    return Z;
  }
  function gcm(key, nonce, plain) {
    if (!isBytes(key) || key.length !== 16) throw new Error('The AES key must be 16 bytes');
    if (!isBytes(nonce) || nonce.length !== 12) throw new Error('The nonce must be 12 bytes');
    if (!isBytes(plain)) throw new Error('The words must be a list of bytes');
    var w = expandKey(key), H = encryptBlock(zeros(16), w), out = [], i, j;
    for (i = 0; i < plain.length; i += 16) {
      var count = i / 16 + 2;            // block 1 is kept for the tag, so the words start at 2
      var stream = encryptBlock(nonce.concat([(count >>> 24) & 255, (count >>> 16) & 255, (count >>> 8) & 255, count & 255]), w);
      for (j = 0; j < 16 && i + j < plain.length; j++) out.push(plain[i + j] ^ stream[j]);
    }
    var X = zeros(16);
    for (i = 0; i < out.length; i += 16) {
      var block = out.slice(i, i + 16);
      while (block.length < 16) block.push(0);
      X = gmul(xorInto(X, block), H);
    }
    var bits = out.length * 8;
    X = gmul(xorInto(X, zeros(12).concat([(bits >>> 24) & 255, (bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255])), H);
    return out.concat(xorInto(encryptBlock(nonce.concat([0, 0, 0, 1]), w), X));
  }

  // ---- the phone's public key: 65 bytes, 04 then X then Y, and it must really be a point on the curve ----
  // (RFC 8291 section 7: skipping this check can let a made-up key leak the sender's key.)
  var CURVE_B = BigInt('0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B');
  function readPhoneKey(p256dh) {
    var bad = new Error('The phone key is not a valid P-256 public key');
    var b;
    try { b = fromB64url(p256dh); } catch (e) { throw bad; }
    if (b.length !== 65 || b[0] !== 4) throw bad;
    var P = ES256.P, x = ES256.bytesToBig(b.slice(1, 33)), y = ES256.bytesToBig(b.slice(33, 65));
    if (x >= P || y >= P) throw bad;
    var left = (y * y) % P, right = (((x * x % P) * x - BigInt(3) * x + CURVE_B) % P + P) % P;
    if (left !== right) throw bad;
    return { bytes: b, x: x, y: y };
  }

  // ---- RFC 8291 section 3.4, step by step. Gives back every in-between value so the tests can check each one. ----
  // words      = the message as bytes (at most 3993)
  // p256dh     = the phone's public key, as the browser gave it (web-safe base64)
  // auth       = the phone's secret, as the browser gave it (web-safe base64, 16 bytes)
  // ephPrivHex = a one-off sender key for this message only (64 hex characters) - see fresh()
  // salt       = 16 random bytes for this message only - see fresh()
  function workings(words, p256dh, auth, ephPrivHex, salt) {
    if (!isBytes(words)) throw new Error('The words must be a list of bytes');
    if (words.length > MAX_WORDS) throw new Error('The words are too long for one push (' + words.length + ' bytes, the limit is ' + MAX_WORDS + ')');
    var ua = readPhoneKey(p256dh);
    var secret;
    try { secret = fromB64url(auth); } catch (e) { secret = []; }
    if (secret.length !== 16) throw new Error('The phone secret must be 16 bytes');
    if (!isBytes(salt) || salt.length !== 16) throw new Error('The salt must be 16 bytes');
    var d = ES256.readKey(ephPrivHex);                 // refuses a bad sender key
    var asPublic = ES256.publicKey(ephPrivHex);        // goes in the message so the phone can do the same sum
    var shared = ES256.multiply(d, ua.x, ua.y);
    if (!shared) throw new Error('The phone key is not a valid P-256 public key');
    var hmac = ES256.hmac, text = ES256.utf8;
    var ecdh = ES256.bigToBytes32(shared[0]);
    var prkKey = hmac(secret, ecdh);
    var keyInfo = text('WebPush: info').concat([0], ua.bytes, asPublic);
    var ikm = hmac(prkKey, keyInfo.concat([1]));
    var prk = hmac(salt, ikm);
    var cek = hmac(prk, text('Content-Encoding: aes128gcm').concat([0, 1])).slice(0, 16);
    var nonce = hmac(prk, text('Content-Encoding: nonce').concat([0, 1])).slice(0, 12);
    var header = salt.concat(RECORD_SIZE, [65], asPublic);          // 16 + 4 + 1 + 65 = 86 bytes
    var body = header.concat(gcm(cek, nonce, words.concat([2])));   // 2 = "this is the last (and only) record"
    return { asPublic: asPublic, ecdh: ecdh, prkKey: prkKey, keyInfo: keyInfo, ikm: ikm, prk: prk, cek: cek, nonce: nonce, header: header, body: body };
  }

  // The finished message: the bytes to send as the body of the push.
  function seal(words, p256dh, auth, ephPrivHex, salt) { return workings(words, p256dh, auth, ephPrivHex, salt).body; }

  // Turns 64 random bytes (the caller supplies them) into what one message needs: a salt and a one-off sender key.
  function fresh(random64) {
    if (!isBytes(random64) || random64.length !== 64) throw new Error('Needs exactly 64 random bytes');
    var k = (ES256.bytesToBig(random64.slice(16)) % (ES256.N - BigInt(1))) + BigInt(1);   // always between 1 and N-1
    return { salt: random64.slice(0, 16), ephPrivHex: k.toString(16).padStart(64, '0') };
  }

  return { seal: seal, workings: workings, fresh: fresh, gcm: gcm, aesBlock: aesBlock, fromB64url: fromB64url, MAX_WORDS: MAX_WORDS };
})();

if (typeof module !== 'undefined') module.exports = LOCK;
