// es256.js - ES256 signing (ECDSA, curve P-256, SHA-256) in plain JavaScript.
// Why: Web Push needs this signature and Google Apps Script has no built-in for it.
// The same file runs in Apps Script (paste it in) and in Node (for the tests).
// Signatures are deterministic (RFC 6979): same key + same message = same signature.
// Known limit: BigInt maths is not constant-time. Fine for a script signing its own
// push passes on Google's servers; do not reuse it where an attacker can time the signing.

var ES256 = (function () {
  'use strict';

  // Apps Script will not SAVE a file containing big-number literals (a number with the letter n on the end), so big numbers are built with BigInt().
  var B0 = BigInt(0), B1 = BigInt(1), B2 = BigInt(2), B3 = BigInt(3), B4 = BigInt(4), B8 = BigInt(8);

  // ---- Curve P-256 (NIST / secp256r1) ----
  var P = BigInt('0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF');
  var N = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
  var GX = BigInt('0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296');
  var GY = BigInt('0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5');

  // ---- SHA-256 and HMAC: the only two things borrowed from the host ----
  var IN_APPS_SCRIPT = (typeof Utilities !== 'undefined');
  function toSigned(b) { return b.map(function (v) { return v > 127 ? v - 256 : v; }); }
  function toUnsigned(b) { return Array.prototype.map.call(b, function (v) { return v < 0 ? v + 256 : v; }); }
  function sha256(msg) {
    if (IN_APPS_SCRIPT) return toUnsigned(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, toSigned(msg)));
    return Array.from(require('crypto').createHash('sha256').update(Buffer.from(msg)).digest());
  }
  function hmac(key, msg) {
    if (IN_APPS_SCRIPT) return toUnsigned(Utilities.computeHmacSha256Signature(toSigned(msg), toSigned(key)));
    return Array.from(require('crypto').createHmac('sha256', Buffer.from(key)).update(Buffer.from(msg)).digest());
  }

  // ---- Numbers <-> bytes ----
  function mod(a, m) { var r = a % m; return r < B0 ? r + m : r; }
  function bytesToBig(b) {
    var h = '';
    for (var i = 0; i < b.length; i++) h += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return h ? BigInt('0x' + h) : B0;
  }
  function bigToBytes32(x) {
    var h = x.toString(16).padStart(64, '0');
    var out = [];
    for (var i = 0; i < 64; i += 2) out.push(parseInt(h.substr(i, 2), 16));
    return out;
  }
  function modPow(base, exp, m) {
    var result = B1; base = mod(base, m);
    while (exp > B0) {
      if (exp & B1) result = (result * base) % m;
      base = (base * base) % m;
      exp >>= B1;
    }
    return result;
  }
  function inverse(a, m) { return modPow(a, m - B2, m); } // m is prime

  // ---- Point maths. Points are kept as [X, Y, Z] (Jacobian) so there is one division at the end. ----
  function dbl(pt) {
    var X1 = pt[0], Y1 = pt[1], Z1 = pt[2];
    if (Z1 === B0 || Y1 === B0) return [B0, B1, B0];
    var delta = (Z1 * Z1) % P, gamma = (Y1 * Y1) % P, beta = (X1 * gamma) % P;
    var alpha = (B3 * (X1 - delta) * (X1 + delta)) % P;
    var X3 = mod(alpha * alpha - B8 * beta, P);
    var Z3 = mod((Y1 + Z1) * (Y1 + Z1) - gamma - delta, P);
    var Y3 = mod(alpha * (B4 * beta - X3) - B8 * gamma * gamma, P);
    return [X3, Y3, Z3];
  }
  function addAffine(pt, x2, y2) {
    var X1 = pt[0], Y1 = pt[1], Z1 = pt[2];
    if (Z1 === B0) return [x2, y2, B1];
    var Z1Z1 = (Z1 * Z1) % P;
    var U2 = (x2 * Z1Z1) % P, S2 = (y2 * Z1 * Z1Z1) % P;
    var H = mod(U2 - X1, P), R = mod(S2 - Y1, P);
    if (H === B0) return R === B0 ? dbl(pt) : [B0, B1, B0];
    var HH = (H * H) % P, HHH = (H * HH) % P, V = (X1 * HH) % P;
    var X3 = mod(R * R - HHH - B2 * V, P);
    var Y3 = mod(R * (V - X3) - Y1 * HHH, P);
    var Z3 = (Z1 * H) % P;
    return [X3, Y3, Z3];
  }
  function multiply(k, x, y) { // k times the point (x, y); returns [x, y] or null for "no point"
    var acc = [B0, B1, B0];
    var bits = k.toString(2);
    for (var i = 0; i < bits.length; i++) {
      acc = dbl(acc);
      if (bits[i] === '1') acc = addAffine(acc, x, y);
    }
    if (acc[2] === B0) return null;
    var zi = inverse(acc[2], P), zi2 = (zi * zi) % P;
    return [(acc[0] * zi2) % P, (acc[1] * zi2 % P) * zi % P];
  }

  // ---- Private key: 64 hex characters, between 1 and N-1 ----
  function readKey(privHex) {
    if (typeof privHex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(privHex)) throw new Error('Private key must be 64 hex characters');
    var x = BigInt('0x' + privHex);
    if (x < B1 || x >= N) throw new Error('Private key out of range');
    return x;
  }

  // ---- The signature: returns 64 bytes, r then s (the form a JWT wants) ----
  function sign(privHex, msgBytes) {
    var x = readKey(privHex);
    var h1 = sha256(msgBytes);
    var e = mod(bytesToBig(h1), N);
    var xb = bigToBytes32(x), hb = bigToBytes32(e);

    // RFC 6979 section 3.2: pick k from the key and the message, no random numbers needed.
    var V = [], K = [], i;
    for (i = 0; i < 32; i++) { V.push(1); K.push(0); }
    K = hmac(K, V.concat([0], xb, hb));
    V = hmac(K, V);
    K = hmac(K, V.concat([1], xb, hb));
    V = hmac(K, V);
    for (;;) {
      V = hmac(K, V);
      var k = bytesToBig(V);
      if (k >= B1 && k < N) {
        var pt = multiply(k, GX, GY);
        var r = mod(pt[0], N);
        if (r !== B0) {
          var s = mod(inverse(k, N) * (e + r * x), N);
          if (s !== B0) return bigToBytes32(r).concat(bigToBytes32(s));
        }
      }
      K = hmac(K, V.concat([0]));
      V = hmac(K, V);
    }
  }

  // ---- Public key: 65 bytes, 04 then X then Y (the form the browser's subscribe() wants) ----
  function publicKey(privHex) {
    var pt = multiply(readKey(privHex), GX, GY);
    return [4].concat(bigToBytes32(pt[0]), bigToBytes32(pt[1]));
  }

  // ---- Text helpers ----
  function utf8(str) {
    var s = unescape(encodeURIComponent(str)), out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function b64url(b) {
    var out = '';
    for (var i = 0; i < b.length; i += 3) {
      var n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
      if (i + 1 < b.length) out += B64[(n >> 6) & 63];
      if (i + 2 < b.length) out += B64[n & 63];
    }
    return out;
  }

  // ---- The VAPID pass: a signed note saying who is sending and to which push service ----
  // audience = the push service's address up to the first slash, e.g. https://fcm.googleapis.com
  // subject  = a contact, e.g. mailto:someone@example.com
  // expSeconds = when the pass runs out, in seconds since 1970 (push services allow at most 24 hours ahead)
  function vapidJwt(privHex, audience, subject, expSeconds) {
    var head = b64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    var body = b64url(utf8(JSON.stringify({ aud: audience, exp: expSeconds, sub: subject })));
    return head + '.' + body + '.' + b64url(sign(privHex, utf8(head + '.' + body)));
  }

  // The last seven are for lock.js (message encryption), which shares this curve maths.
  return { sign: sign, publicKey: publicKey, b64url: b64url, vapidJwt: vapidJwt, utf8: utf8, N: N,
    P: P, multiply: multiply, hmac: hmac, bytesToBig: bytesToBig, bigToBytes32: bigToBytes32, readKey: readKey };
})();

if (typeof module !== 'undefined') module.exports = ES256;
