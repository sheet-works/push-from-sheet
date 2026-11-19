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
// push.js - builds the request a Google Sheet sends to a push service to wake a phone or browser.
// The push is EMPTY (no message inside), so no encryption is needed: only the signed VAPID pass.
// The page's service worker shows the notification (and can fetch the text from the sheet).
// Needs es256.js. Runs in Apps Script and in Node (for the tests). It only BUILDS the request;
// the caller sends it (in Apps Script: UrlFetchApp.fetch(r.url, { method: r.method, headers: r.headers })).

if (typeof module !== 'undefined' && typeof ES256 === 'undefined') { var ES256 = require('./es256.js'); }

var PUSH = (function () {
  'use strict';

  var PASS_LASTS_SECONDS = 12 * 3600; // push services refuse a pass that lasts more than 24 hours
  var URGENCIES = ['very-low', 'low', 'normal', 'high'];

  // The push service's address up to the first slash, e.g. https://fcm.googleapis.com
  // (Apps Script has no URL tool, so this is done by hand.)
  function audienceOf(endpoint) {
    if (typeof endpoint !== 'string') throw new Error('Push address must be text');
    // The host may only be letters, digits, dots and dashes (plus an optional :port), and must END there.
    // That refuses trick addresses like https://fcm.googleapis.com@evil.com/ which really point at evil.com.
    var m = new RegExp('^https://([A-Za-z0-9.-]+(:[0-9]+)?)([/?#]|$)').exec(endpoint);
    if (!m) throw new Error('Push address must be a plain https:// address');
    var host = m[1].toLowerCase();
    if (host.slice(-4) === ':443') host = host.slice(0, -4);
    return 'https://' + host;
  }

  // endpoint   = the long address the browser gave when the person tapped Allow
  // privHex    = the sheet owner's private key (64 hex characters)
  // subject    = a contact for the push service: mailto:someone@example.com or an https:// address
  // nowSeconds = the time now, in SECONDS since 1970
  // ttlSeconds = how long the push service should keep trying if the phone is off
  // urgency    = optional: very-low, low, normal or high. high asks the push service to wake a sleeping phone.
  // body       = optional: the locked words from lock.js (bytes 0-255). Left out = an empty push.
  function buildRequest(endpoint, privHex, subject, nowSeconds, ttlSeconds, urgency, body) {
    var aud = audienceOf(endpoint);
    var okSubject = typeof subject === 'string' &&
      ((subject.indexOf('mailto:') === 0 && subject.length > 7) || (subject.indexOf('https://') === 0 && subject.length > 8));
    if (!okSubject) throw new Error('Contact must start with mailto: or https://');
    if (typeof nowSeconds !== 'number' || !isFinite(nowSeconds) || nowSeconds < 1000000000 || nowSeconds > 9999999999) {
      throw new Error('Time must be in seconds since 1970 (not milliseconds)');
    }
    if (!isFinite(ttlSeconds) || ttlSeconds < 0 || Math.floor(ttlSeconds) !== ttlSeconds) {
      throw new Error('TTL must be a whole number of seconds, zero or more');
    }
    if (urgency !== undefined && URGENCIES.indexOf(urgency) === -1) {
      throw new Error('Urgency must be very-low, low, normal or high');
    }
    // The pass is dated from the start of the clock hour. Signing is deterministic, so every push in the
    // same hour carries the very same pass - Apple asks that a pass is not remade more than once an hour.
    var hourStart = Math.floor(nowSeconds / 3600) * 3600;
    var pass = ES256.vapidJwt(privHex, aud, subject, hourStart + PASS_LASTS_SECONDS);
    var publicKey = ES256.b64url(ES256.publicKey(privHex));
    var headers = { TTL: String(ttlSeconds), Authorization: 'vapid t=' + pass + ', k=' + publicKey };
    if (urgency !== undefined) headers.Urgency = urgency;
    var request = { url: endpoint, method: 'post', headers: headers };
    if (body !== undefined && body !== null) {
      if (!isBytes(body) || body.length < 1 || body.length > 4096) throw new Error('The body must be 1 to 4096 bytes');
      headers['Content-Encoding'] = 'aes128gcm';
      headers['Content-Type'] = 'application/octet-stream';
      request.payload = body.map(function (v) { return v > 127 ? v - 256 : v; }); // UrlFetchApp wants bytes as -128 to 127
    }
    return request;
  }

  function isBytes(b) {
    if (!Array.isArray(b)) return false;
    for (var i = 0; i < b.length; i++) { if (typeof b[i] !== 'number' || b[i] < 0 || b[i] > 255 || Math.floor(b[i]) !== b[i]) return false; }
    return true;
  }

  // The words to lock into a push, in Apple's Declarative Web Push shape (iPhone 18.4+ shows it by itself;
  // other browsers hand it to the page's worker, which shows the same thing).
  // at = the sheet's time for this message (ms); it becomes the tag, so a repeat of the same message replaces itself.
  // navigate = where tapping the notification goes (must be https).
  function message(title, body, at, navigate) {
    if (typeof title !== 'string' || !title) throw new Error('The title must be some text');
    if (typeof body !== 'string') throw new Error('The message must be text');
    if (typeof at !== 'number' || !isFinite(at)) throw new Error('The time must be a number');
    if (typeof navigate !== 'string' || navigate.indexOf('https://') !== 0) throw new Error('The address to open must start with https://');
    return JSON.stringify({ web_push: 8030, notification: { title: title, body: body, navigate: navigate, tag: 'push-from-sheet-' + at } });
  }

  return { audienceOf: audienceOf, buildRequest: buildRequest, message: message };
})();

if (typeof module !== 'undefined') module.exports = PUSH;
// hub.js - the script-side logic for phones: sign up, sign out, and the list of phones to send to.
// Version 1 (ruling 17 Nov 2026): the words always travel LOCKED INSIDE the push (lock.js), so a phone
// never comes back to fetch them. That is why every phone must hand over its two encryption keys to sign up.
// Needs push.js. Runs in Apps Script and in Node (for the tests).
// It never touches Apps Script directly: the caller hands in a "store" with get / set / remove / keys
// (in Apps Script that is Script Properties). Everything kept in the store is text.

if (typeof module !== 'undefined' && typeof PUSH === 'undefined') { var PUSH = require(process.env.PUSH || './push.js'); }

var PUSHHUB = (function () {
  'use strict';

  // One truth for a device's short name: phonetab.js (asked when used, so the order of the pasted files does not matter).
  function shortName(id) { return (typeof PHONETAB !== 'undefined' ? PHONETAB : require(process.env.PHONETAB || './phonetab.js')).shortName(id); }
  var PHONE = 'phone_';      // one entry per signed-up phone: phone_<id>
  var ID_SHAPE = new RegExp('^[0-9a-f]{32}$');
  var MAX_ADDRESS = 600;
  // The two encryption keys a browser hands over with its push address. The words are locked with them.
  // Every browser that can do web push has them (Push API; Safari on iPhone since 16.4, when web push began).
  var P256DH_SHAPE = new RegExp('^B[A-Za-z0-9_-]{86}$'); // the phone's public key: 87 web-safe letters, always starting with B
  var AUTH_SHAPE = new RegExp('^[A-Za-z0-9_-]{22}$');    // the phone's secret: 22 web-safe letters
  // The email an AppSheet link can add to the page address (not proof of who it is), and the page's short device name.
  var EMAIL_SHAPE = new RegExp('^[^\\s@<>"]{1,64}@[^\\s@<>"]+\\.[^\\s@<>"]{2,}$');
  var MAX_EMAIL = 254, MAX_DEVICE = 40;
  var DEVICE_JUNK = new RegExp('[^A-Za-z0-9 ,.()-]', 'g');

  // Only the real push services. Without this, anyone who found the web app address could
  // sign up their own server and make the script call it.
  var EXACT_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com'];
  var HOST_ENDINGS = ['.push.apple.com', '.notify.windows.com'];
  function allowedEndpoint(endpoint) {
    if (typeof endpoint !== 'string' || endpoint.length > MAX_ADDRESS || endpoint.indexOf(' ') !== -1) return false;
    var host;
    try { host = PUSH.audienceOf(endpoint).slice('https://'.length); } catch (e) { return false; }
    if (EXACT_HOSTS.indexOf(host) !== -1) return true;
    for (var i = 0; i < HOST_ENDINGS.length; i++) {
      var end = HOST_ENDINGS[i];
      if (host.length > end.length && host.slice(-end.length) === end) return true;
    }
    return false;
  }

  function readPhone(store, id) {
    var text = store.get(PHONE + id);
    return text ? JSON.parse(text) : null;
  }
  function writePhone(store, id, p) { store.set(PHONE + id, JSON.stringify(p)); }

  // Every phone record in the store, oldest first. letIn = true: phones the owner has let in
  // (phones from before approval existed have no flag and count as let in); false: phones still waiting.
  function phoneRecords(store, letIn) {
    var out = [];
    store.keys().forEach(function (k) {
      if (k.indexOf(PHONE) !== 0) return;
      var p = JSON.parse(store.get(k));
      if ((p.approved !== false) !== letIn) return;
      out.push({ id: k.slice(PHONE.length), p: p });
    });
    out.sort(function (a, b) { return a.p.added - b.p.added || (a.id < b.id ? -1 : 1); });
    return out;
  }

  // The phones that get messages: let in by the owner, and holding both keys, oldest first.
  // A record with no keys is from before version 1; that phone is sent nothing until it opens the page again.
  function phones(store) {
    var out = [];
    phoneRecords(store, true).forEach(function (r) {
      if (!r.p.p256dh || !r.p.auth) return;
      out.push({ id: r.id, endpoint: r.p.endpoint, added: r.p.added, lastSend: r.p.lastSend || 0, lastCode: r.p.lastCode || 0, p256dh: r.p.p256dh, auth: r.p.auth });
    });
    return out;
  }

  // Phones that have signed up and are waiting for the owner to let them in, oldest first.
  function waitingToJoin(store) {
    return phoneRecords(store, false).map(function (r) {
      return { id: r.id, name: shortName(r.id), endpoint: r.p.endpoint, added: r.p.added };
    });
  }

  // True when no more phones can be let in.
  function full(store, config) { return phones(store).length >= config.maxPhones; }

  // The owner lets a waiting phone in. It gets messages sent from then on.
  function letIn(store, id, config) {
    var phone = readPhone(store, id);
    if (!phone) return 'unknown phone';
    if (phone.approved !== false) return 'already in';
    if (full(store, config)) return 'full';
    phone.approved = true;
    writePhone(store, id, phone);
    return 'let in';
  }

  // What the web app answers. params = the bits after the ? in the address.
  // config = { publicKey: the key the page needs to sign up, maxPhones: the cap, signup: 'open' or anything else (owner approves),
  //            maxWaitingToJoin: how many may wait for the owner (default 10) }
  function handle(params, store, nowMs, config) {
    var action = params && params.action;
    if (action === 'key') return { ok: true, publicKey: config.publicKey };
    if (action !== 'subscribe' && action !== 'unsubscribe' && action !== 'recent') return { ok: false, error: 'unknown action' };

    var id = params.id;
    if (typeof id !== 'string' || !ID_SHAPE.test(id)) return { ok: false, error: 'bad id' };

    // 18 Nov: the page's Recent list comes from here (the iPhone worker's own log never reached the page).
    // The id is the device's own 32-letter secret, so only that device can read its messages.
    if (action === 'recent') {
      var me = readPhone(store, id);
      if (!me) return { ok: false, error: 'not signed up' };
      var mine = { ok: true, recent: (me.recent || []).slice() };
      if (me.approved === false) mine.waiting = true;   // so the page can say "waiting to be let in" (cold test 18 Nov)
      return mine;
    }

    if (action === 'unsubscribe') {
      store.remove(PHONE + id);
      return { ok: true };
    }

    // action === 'subscribe'
    if (!allowedEndpoint(params.endpoint)) return { ok: false, error: 'bad address' };
    if (typeof params.p256dh !== 'string' || !P256DH_SHAPE.test(params.p256dh) ||
        typeof params.auth !== 'string' || !AUTH_SHAPE.test(params.auth)) return { ok: false, error: 'bad keys' };
    var phone = readPhone(store, id);
    if (!phone) {
      // ruling 17 Nov: the owner lets each new phone in unless the setting is exactly 'open' (a typo never opens it up).
      var open = config.signup === 'open';
      if (open && full(store, config)) return { ok: false, error: 'full' };
      var maxWaiting = typeof config.maxWaitingToJoin === 'number' ? config.maxWaitingToJoin : 10;
      if (!open && waitingToJoin(store).length >= maxWaiting) return { ok: false, error: 'too many waiting' };
      phone = { added: nowMs, lastSend: 0, lastCode: 0, approved: open };
    }
    delete phone.lastFetch; // left over from the fetch-back days
    var email = typeof params.email === 'string' ? params.email.trim() : '';
    if (email.length <= MAX_EMAIL && EMAIL_SHAPE.test(email)) phone.email = email;
    if (typeof params.device === 'string') phone.device = params.device.replace(DEVICE_JUNK, '').trim().slice(0, MAX_DEVICE);
    phone.lastSeen = nowMs;
    phone.endpoint = params.endpoint;
    phone.p256dh = params.p256dh;
    phone.auth = params.auth;
    writePhone(store, id, phone);
    var answer = { ok: true, name: shortName(id) };
    if (phone.approved === false) answer.waiting = true;
    return answer;
  }

  // Every stored phone, let in or waiting, oldest first, with what the Phones tab needs (phonetab.js).
  function records(store) {
    var out = [];
    store.keys().forEach(function (k) {
      if (k.indexOf(PHONE) !== 0) return;
      var p = JSON.parse(store.get(k));
      out.push({ id: k.slice(PHONE.length), approved: p.approved !== false, stopped: p.stopped === true, listed: p.listed === true,
        added: p.added || 0, lastSeen: p.lastSeen || 0, lastSend: p.lastSend || 0, email: p.email || '', device: p.device || '', keys: !!(p.p256dh && p.auth) });
    });
    out.sort(function (a, b) { return a.added - b.added || (a.id < b.id ? -1 : 1); });
    return out;
  }

  // Applies one change from the Phones tab: { id, approved?, stopped?, listed?, remove? }. A phone that is not there is skipped.
  function update(store, change) {
    var phone = readPhone(store, change.id);
    if (!phone) return;
    if (change.remove) { store.remove(PHONE + change.id); return; }
    ['approved', 'stopped', 'listed'].forEach(function (k) { if (typeof change[k] === 'boolean') phone[k] = change[k]; });
    writePhone(store, change.id, phone);
  }

  // Call after each push with the push service's answer.
  // 404 or 410 = that sign-up no longer exists (app removed, permission taken back): forget the phone.
  // msg (optional) = { title, body, at }: a delivered one is kept for the device's Recent list (newest first, last 10).
  var RECENT_KEEP = 10, RECENT_TITLE = 120, RECENT_BODY = 300;
  function recordSend(store, id, statusCode, nowMs, msg) {
    var phone = readPhone(store, id);
    if (!phone) return 'unknown phone';
    if (statusCode === 404 || statusCode === 410) { store.remove(PHONE + id); return 'removed'; }
    phone.lastCode = statusCode;
    var sent = statusCode >= 200 && statusCode < 300;
    if (sent) phone.lastSend = nowMs;
    if (sent && msg) {
      phone.recent = [{ title: String(msg.title || '').slice(0, RECENT_TITLE), body: String(msg.body || '').slice(0, RECENT_BODY), at: msg.at || nowMs }]
        .concat(phone.recent || []).slice(0, RECENT_KEEP);
    }
    writePhone(store, id, phone);
    return sent ? 'sent' : 'failed';
  }

  return { handle: handle, phones: phones, records: records, update: update, allowedEndpoint: allowedEndpoint, recordSend: recordSend, waitingToJoin: waitingToJoin, letIn: letIn };
})();

if (typeof module !== 'undefined') module.exports = PUSHHUB;
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
// engine.js - decides, for each new row in the owner's tab, what the notification says and which phones get it,
// and writes the note that goes back into the row's Notified cell.
// SPEC_V1.md: a new row with a title and a blank Notified is sent. Push To blank = every let-in phone;
// Push To with names or emails = only those phones. The link column (e.g. the AppSheet record) is what a tap opens.
// It never touches Apps Script: the caller hands in the header row, the rows as text, the settings and the phones.
// Runs in Apps Script and in Node (for the tests).

var ENGINE = (function () {
  'use strict';

  var SENDING = 'Sending...';           // written into a row BEFORE its push goes, so a failed run is never sent again and again
  var SOON = 'Sending soon...';         // 18 Nov: a new row waits until it has sat unchanged (Setup's Wait before sending), so a row typed by hand goes out complete
  var OLD = 'Old row - not sent';       // written into rows that were already there when the owner turned it on
  var AGAIN = 'Sending again...';       // written into a stuck row BEFORE its one second try (go-ahead, 18 Nov)
  var GAVE_UP = 'Failed twice - may not have been sent';   // a row whose second try also died. It is never tried a third time
  var STUCK_MINUTES = 10;               // a row still on Sending... this long after its run started is stuck (a run cannot last that long)
  var MAX_TITLE = 100, MAX_BODY = 500;  // longer words are cut, ending in ...
  var MAX_AT_ONCE = 10;                // ruling 17 Nov: more new rows than this in one run (an import) are not sent
  var TOO_MANY = 'Not sent - too many new rows at once';
  var SPLIT = new RegExp('[,;\\n]');    // Push To may list people split by commas, semicolons or new lines

  function cell(row, i) {
    var v = row[i];
    return (v === undefined || v === null) ? '' : String(v).trim();
  }
  function cut(text, max) { return text.length > max ? text.slice(0, max - 3) + '...' : text; }
  function key(text) { return String(text || '').trim().toLowerCase(); }

  // Where each named column is, counting from 0. A name that is not in the header is refused by name.
  function finder(header) {
    var names = header.map(function (h) { return String(h).trim(); });
    return function (name) {
      var i = names.indexOf(String(name).trim());
      if (i < 0) throw new Error('No column called "' + name + '"');
      return i;
    };
  }

  // Which phones a Push To cell means. Blank = every phone. Otherwise each name or email, matched without caring
  // about capitals or spaces, picks every phone with that name or email. Names that pick nothing come back as unknown.
  function pick(pushTo, phones) {
    var asked = pushTo.split(SPLIT).map(function (t) { return t.trim(); }).filter(function (t) { return t !== ''; });
    if (!asked.length) return { phoneIds: phones.map(function (p) { return p.id; }), unknown: [] };
    var chosen = {}, unknown = [];
    asked.forEach(function (who) {
      var k = key(who), found = false;
      phones.forEach(function (p) {
        if (key(p.name) === k || key(p.email) === k) { chosen[p.id] = true; found = true; }
      });
      if (!found) unknown.push(who);
    });
    return { phoneIds: phones.filter(function (p) { return chosen[p.id]; }).map(function (p) { return p.id; }), unknown: unknown };
  }

  // One plan per new row, oldest first: { row, title, body, navigate, phoneIds, unknown }.
  // retry = true (the 10-minute backup check, when quiet() says so): rows stuck on Sending... are planned again, with retry: true.
  // What a tap may open (18 Nov). links = 'any': any https site. Otherwise (the default) only AppSheet and Google
  // addresses: AppSheet record links, Maps, Drive, Docs. Gives '' when the link is fine, or the reason it is skipped.
  var HOST = new RegExp('^https://([^/?#:@]+)(?::[0-9]+)?(?:[/?#]|$)', 'i');
  var SAFE_HOSTS = ['appsheet.com', 'google.com', 'goo.gl'];
  function linkProblem(link, links) {
    var m = HOST.exec(link);
    if (!m) return 'links must start with https://';
    if (links === 'any') return '';
    var host = m[1].toLowerCase();
    var ok = SAFE_HOSTS.some(function (h) { return host === h || host.slice(-(h.length + 1)) === '.' + h; });
    return ok ? '' : 'only AppSheet and Google links';
  }

  // settings = { title: column, message: column or list of columns, notified: column, pushTo: column (optional), link: column (optional) }
  // phones = [{ id, name, email }] - the let-in phones. page = the owner's phone page (opened when there is no link).
  function plan(header, rows, settings, phones, page, retry) {
    var col = finder(header);
    var t = col(settings.title), n = col(settings.notified);
    var m = (Array.isArray(settings.message) ? settings.message : [settings.message]).map(col);
    var to = settings.pushTo ? col(settings.pushTo) : -1;
    var ln = settings.link ? col(settings.link) : -1;
    var out = [];
    rows.forEach(function (r, i) {
      var title = cell(r, t), mark = cell(r, n);
      var again = !!retry && mark === SENDING;
      if (title === '' || (mark !== '' && mark !== SOON && !again)) return;
      var body = m.map(function (c) { return cell(r, c); }).filter(function (w) { return w !== ''; }).join(', ');
      var link = ln >= 0 ? cell(r, ln) : '';
      var who = pick(to >= 0 ? cell(r, to) : '', phones);
      var why = link === '' ? '' : linkProblem(link, settings.links);
      var p = { row: i, title: cut(title, MAX_TITLE), body: cut(body, MAX_BODY), navigate: link !== '' && !why ? link : page,
        phoneIds: who.phoneIds, unknown: who.unknown };
      if (why) p.linkSkipped = why;
      if (again) p.retry = true;
      out.push(p);
    });
    return out;
  }

  // The wait. pending() = the rows waiting to go, by row number, each with all its words (every cell except Notified).
  // settled() = the rows that were waiting at the first look and have not changed at all by the second look.
  function pending(header, rows, settings) {
    var col = finder(header), t = col(settings.title), n = col(settings.notified), out = {};
    rows.forEach(function (r, i) {
      var mark = cell(r, n);
      if (cell(r, t) === '' || (mark !== '' && mark !== SOON)) return;
      out[i] = JSON.stringify(header.map(function (h, c) { return c === n ? '' : cell(r, c); }));
    });
    return out;
  }
  function settled(before, after) {
    return Object.keys(after).filter(function (i) { return before[i] === after[i]; }).map(Number);
  }
  // The plans that may go now: second tries always, new rows only when settled (rows = null means there is no wait).
  function ready(plans, rows) {
    return rows ? plans.filter(function (p) { return !!p.retry || rows.indexOf(p.row) >= 0; }) : plans;
  }

  // The rows whose second try also died (still on AGAIN). The backup check marks them GAVE_UP when quiet() says so.
  function failedTwice(header, rows, settings) {
    var n = finder(header)(settings.notified), out = [];
    rows.forEach(function (r, i) { if (cell(r, n) === AGAIN) out.push(i); });
    return out;
  }

  // May stuck rows be tried again? Only when every run that marked rows started STUCK_MINUTES or more ago.
  // starts = the start times (ms, as numbers or text) of runs that marked rows and have not finished. A broken time counts as old.
  function quiet(starts, now) {
    return !starts.some(function (s) { return Number(s) > now - STUCK_MINUTES * 60000; });
  }

  // Splits a run's plans into those to send and the rows to mark TOO_MANY (every new row, when there are more than MAX_AT_ONCE).
  // Second tries are always sent and do not count toward the limit.
  function batch(plans) {
    var fresh = plans.filter(function (p) { return !p.retry; });
    if (fresh.length > MAX_AT_ONCE) return { send: plans.filter(function (p) { return !!p.retry; }), skip: fresh.map(function (p) { return p.row; }) };
    return { send: plans, skip: [] };
  }

  // The note written back into Notified after sending. result = { sent, failed, unknown, retry }. Never empty.
  function note(result, clockText) {
    var text;
    if (result.sent) text = 'Sent ' + clockText + ' to ' + result.sent + (result.sent === 1 ? ' device' : ' devices') + (result.failed ? ', ' + result.failed + ' failed' : '');
    else text = 'Not sent ' + clockText + (result.failed ? ' - ' + result.failed + ' failed' : (result.unknown.length ? '' : ' - no devices to send to'));
    if (result.unknown.length) text += ' - no device for ' + result.unknown.join(', ');
    if (result.linkSkipped) text += ' - link skipped (' + result.linkSkipped + ')';
    if (result.retry) text += ' (second try)';
    return text;
  }

  return { pending: pending, settled: settled, ready: ready, SOON: SOON, plan: plan, batch: batch, note: note, failedTwice: failedTwice, quiet: quiet, SENDING: SENDING, AGAIN: AGAIN, GAVE_UP: GAVE_UP, OLD: OLD, TOO_MANY: TOO_MANY,
    MAX_AT_ONCE: MAX_AT_ONCE, STUCK_MINUTES: STUCK_MINUTES };
})();

if (typeof module !== 'undefined') module.exports = ENGINE;
// setup.js - reads the owner's settings off the Setup tab and says plainly what is wrong.
// Look B (the pick, 17 Nov 2026): each setting is a label in column B with its value in column C.
// Settings are found by their LABEL, not their row, so moving or adding rows never breaks it.
// It never touches Apps Script: the caller hands in the tab's displayed values (getDisplayValues).
// Runs in Apps Script and in Node (for the tests).

var SETUP = (function () {
  'use strict';

  var REPO = 'github.com/sheet-works/push-from-sheet';   // one truth: where the code and README live
  var VERSION = '1.0';                      // the one version number (the menu's Check for update and the Setup tab use it)
  var NOTIFIED = 'Notified';                 // the column the script writes its note into (added if missing)
  // 18 Nov: the owner picks a plain colour name from a dropdown; a code like #1565C0 still works for an exact brand colour.
  var COLOURS = { Blue: '#1565C0', Navy: '#1A237E', Green: '#2E7D32', Teal: '#00796B', Red: '#C62828', Orange: '#EF6C00',
    Purple: '#6A1B9A', Pink: '#AD1457', Grey: '#546E7A', Black: '#212121' };
  var DEFAULT_COLOUR_NAME = 'Blue', DEFAULT_COLOUR = COLOURS.Blue;
  var APPSHEET_LABEL = 'Making an AppSheet app?';   // 18 Nov: the longer label was cut off in its column
  var LINKS_LABEL = 'Links can open', LINKS_GOOGLE = 'AppSheet and Google only', LINKS_ANY = 'Any website';
  // 18 Nov (cold test): the message is up to three single picks, each its own dropdown, joined in order.
  var MESSAGE_LABELS = ['Message column', 'Message column 2 (optional)', 'Message column 3 (optional)'];
  // 18 Nov: a row typed by hand is sent once it has sat unchanged this long, so it goes out complete.
  // Off = at once (AppSheet adds a whole row in one go). Blank follows the AppSheet answer.
  var WAIT_LABEL = 'Wait before sending', WAIT_CHOICES = ['Off', '30 seconds', '1 minute'], WAIT_SECONDS = [0, 30, 60];
  function waitDefault(appsheet) { return appsheet ? WAIT_CHOICES[0] : WAIT_CHOICES[1]; }
  var MAX_APP_NAME = 30;                     // a Home Screen name has to stay short
  var PROJECT_LABEL = 'Firebase project address', OLD_PROJECT_LABELS = ['Firebase project name', 'Firebase project ID'];   // one truth for the row's name
  var PROJECT_SHAPE = new RegExp('^[a-z][a-z0-9-]{4,28}[a-z0-9]$'); // Firebase project IDs: 6 to 30 characters
  // 18 Nov: the owner may paste the address of their project page instead (.../project/THE-ID/... or ...?project=THE-ID).
  var PROJECT_IN_LINK = new RegExp('[/?&]project[/=]([^/?&#]+)');
  var SPACES = new RegExp(' +');
  // 18 Nov: how often the backup check runs is the owner's pick. Google's timers come in 1, 5, 10, 15 or 30 minutes;
  // 1 is not offered because it would use more than a free account's daily allowance. 0 = off.
  var BACKUP_CHOICES = [5, 10, 15, 30], BACKUP_DEFAULT = 10;
  var BACKUP_SHAPE = new RegExp('^([0-9]+) ?(min|mins|minute|minutes)?$');
  var COLOUR_SHAPE = new RegExp('^#[0-9A-F]{6}$');
  var DRIVE_ID = new RegExp('^[A-Za-z0-9_-]{20,}$');
  var DRIVE_LINK = new RegExp('^https://drive\\.google\\.com/(?:file/d/([A-Za-z0-9_-]{20,})|open\\?id=([A-Za-z0-9_-]{20,}))');

  function text(v) { return (v === undefined || v === null) ? '' : String(v).trim(); }

  // label -> value, from column B and column C of every row.
  function pairs(grid) {
    var out = {};
    (grid || []).forEach(function (row) {
      if (!row) return;
      var label = text(row[1]);
      if (label !== '' && !(label in out)) out[label] = text(row[2]);
    });
    return out;
  }

  // 'Green' (any case) or '#2e7d32' -> '#2E7D32'. Anything else -> ''.
  function colourOf(v) {
    var t = text(v);
    for (var n in COLOURS) if (n.toLowerCase() === t.toLowerCase()) return COLOURS[n];
    return COLOUR_SHAPE.test(t.toUpperCase()) ? t.toUpperCase() : '';
  }

  function driveId(v) {
    if (DRIVE_ID.test(v)) return v;
    var m = v.match(DRIVE_LINK);
    return m ? (m[1] || m[2]) : '';
  }

  // { settings, problems } - problems are plain sentences for the owner, in the order the settings appear.
  function read(grid) {
    var p = pairs(grid), problems = [];
    var get = function (label) { return p[label] || ''; };

    // 18 Nov 9:15pm: one way only - copy the project page's address from the address bar and paste it in. The ID is
    // taken out of the address exactly as it is. A bare ID or name still works (the old labels are still read).
    var typed = [PROJECT_LABEL].concat(OLD_PROJECT_LABELS).map(get).filter(function (v) { return v !== ''; })[0] || '', inLink = PROJECT_IN_LINK.exec(typed);
    var project = inLink ? inLink[1] : typed.toLowerCase().split(SPACES).join('-');
    var pasteIt = 'open your project in Firebase, copy the address from the address bar and paste it here (step 1).';
    if (typed === '') problems.push(PROJECT_LABEL + ' is empty - ' + pasteIt);
    else if (!PROJECT_SHAPE.test(project)) problems.push(PROJECT_LABEL + ' "' + typed + '" is not the address of a Firebase project - ' + pasteIt);

    var appName = get('App name');
    if (appName === '') problems.push('App name is empty.');
    else if (appName.length > MAX_APP_NAME) problems.push('App name is too long - ' + MAX_APP_NAME + ' characters at most.');

    var colourText = get('Colour'), colour = colourOf(colourText);
    if (colourText !== '' && !colour) problems.push('Colour "' + colourText + '" is not one of the colours in the list or a code like ' + DEFAULT_COLOUR + ' - using ' + DEFAULT_COLOUR_NAME + '.');
    colour = colour || DEFAULT_COLOUR;

    var iconText = get('Icon'), icon = '';
    if (iconText !== '' && iconText.toLowerCase() !== 'plain default') {
      icon = driveId(iconText);
      if (icon === '') problems.push('Icon "' + iconText + '" is not a Drive link - using the plain default.');
    }

    var tab = get('Tab with your rows');
    if (tab === '') problems.push('Tab with your rows is empty.');
    var title = get('Title column');
    if (title === '') problems.push('Title column is empty.');
    var message = MESSAGE_LABELS.map(get).join(',').split(',').map(text).filter(function (m) { return m !== ''; });
    if (!message.length) problems.push('Message column is empty.');
    var pushTo = get('Push To column'), link = get('Link to open');

    var signupText = get('Sign-ups'), signup = signupText.toLowerCase() === 'open' ? 'open' : 'approve';
    if (signupText !== '' && signup !== 'open' && signupText.toLowerCase() !== 'approve') problems.push('Sign-ups "' + signupText + '" should be Open or Approve - using Approve.');

    // 18 Nov: AppSheet builds a new app from the FIRST tab, so Yes moves the owner's tab first at Set up.
    var appsheetText = get(APPSHEET_LABEL).toLowerCase(), appsheetFirst = appsheetText === 'yes';
    if (appsheetText !== '' && appsheetText !== 'yes' && appsheetText !== 'no') problems.push(APPSHEET_LABEL + ' "' + get(APPSHEET_LABEL) + '" should be Yes or No - using No.');
    // 18 Nov: what a tap may open. The safe one is the default (stops a fake page that looks like it came from the boss).
    var linksText = get(LINKS_LABEL), links = linksText.toLowerCase() === LINKS_ANY.toLowerCase() ? 'any' : 'google';
    if (linksText !== '' && links !== 'any' && linksText.toLowerCase() !== LINKS_GOOGLE.toLowerCase()) problems.push(LINKS_LABEL + ' "' + linksText + '" should be ' + LINKS_GOOGLE + ', or ' + LINKS_ANY + ' - using ' + LINKS_GOOGLE + '.');

    var waitText = get(WAIT_LABEL) || waitDefault(appsheetFirst), waitAt = WAIT_CHOICES.map(function (c) { return c.toLowerCase(); }).indexOf(waitText.toLowerCase());
    if (waitAt < 0) { problems.push(WAIT_LABEL + ' "' + waitText + '" should be Off, 30 seconds or 1 minute - using 30 seconds.'); waitAt = 1; }

    var backupText = get('Backup check'), backup = BACKUP_DEFAULT, asked = BACKUP_SHAPE.exec(backupText.toLowerCase());
    if (backupText.toLowerCase() === 'off') backup = 0;
    else if (asked && BACKUP_CHOICES.indexOf(Number(asked[1])) >= 0) backup = Number(asked[1]);
    else if (backupText !== '') problems.push('Backup check "' + backupText + '" should be Off, 5, 10, 15 or 30 minutes - using ' + BACKUP_DEFAULT + '.');

    // The same column must not do two jobs, and none may be the script's own Notified column.
    var jobs = [['Title', title]].concat(message.map(function (m) { return ['Message', m]; }), [['Push To', pushTo], ['Link', link]]);
    jobs.forEach(function (j) { if (j[1] === NOTIFIED) problems.push('"' + NOTIFIED + '" is kept for the script - pick another ' + j[0] + ' column.'); });
    for (var a = 0; a < jobs.length; a++) {
      for (var b = a + 1; b < jobs.length; b++) {
        if (jobs[a][1] !== '' && jobs[a][1] === jobs[b][1] && jobs[a][1] !== NOTIFIED) {
          problems.push('The ' + jobs[a][0] + ' column and the ' + jobs[b][0] + ' column are the same column ("' + jobs[a][1] + '").');
        }
      }
    }

    return {
      settings: { firebaseProject: project, appName: appName, colour: colour, icon: icon, tab: tab, title: title, message: message,
        pushTo: pushTo, link: link, notified: NOTIFIED, signup: signup, backupMinutes: backup, appsheetFirst: appsheetFirst, links: links, waitSeconds: WAIT_SECONDS[waitAt] },
      problems: problems
    };
  }

  return { REPO: REPO, PROJECT_LABEL: PROJECT_LABEL, OLD_PROJECT_LABELS: OLD_PROJECT_LABELS, MESSAGE_LABELS: MESSAGE_LABELS, WAIT_LABEL: WAIT_LABEL, WAIT_CHOICES: WAIT_CHOICES, waitDefault: waitDefault, read: read, pairs: pairs, VERSION: VERSION, NOTIFIED: NOTIFIED, BACKUP_CHOICES: BACKUP_CHOICES, BACKUP_DEFAULT: BACKUP_DEFAULT, MAX_APP_NAME: MAX_APP_NAME,
    DEFAULT_COLOUR: DEFAULT_COLOUR, DEFAULT_COLOUR_NAME: DEFAULT_COLOUR_NAME, COLOURS: COLOURS, colourOf: colourOf,
    APPSHEET_LABEL: APPSHEET_LABEL, LINKS_LABEL: LINKS_LABEL, LINKS_GOOGLE: LINKS_GOOGLE, LINKS_ANY: LINKS_ANY };
})();

if (typeof module !== 'undefined') module.exports = SETUP;
// png.js - makes a two-colour PNG picture from a grid of 0s and 1s (the QR code, the plain default icon).
// No libraries and nothing from Apps Script: the picture data is stored unpacked (the page upload gzips it anyway).
// Runs in Apps Script and in Node (for the tests).
var PNG = (function () {
  'use strict';

  var TABLE = null;
  function crc32(bytes) {
    if (!TABLE) {
      TABLE = [];
      for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); TABLE.push(c >>> 0); }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = TABLE[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function adler32(bytes) {
    var a = 1, b = 0;
    for (var i = 0; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; }
    return ((b << 16) | a) >>> 0;
  }
  function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function chunk(type, data) {
    var body = [type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)].concat(data);
    return u32(data.length).concat(body, u32(crc32(body)));
  }
  // zlib wrapping with "stored" blocks: 2 header bytes, then blocks of up to 65535 bytes, then the Adler-32 check.
  function stored(raw) {
    var out = [0x78, 0x01];
    for (var at = 0; at < raw.length || at === 0; at += 65535) {
      var len = Math.min(65535, raw.length - at), last = at + len >= raw.length;
      out.push(last ? 1 : 0, len & 255, len >>> 8, (~len) & 255, ((~len) >>> 8) & 255);
      for (var i = 0; i < len; i++) out.push(raw[at + i]);
      if (last) break;
    }
    return out.concat(u32(adler32(raw)));
  }

  // '#1F2A30' -> [31, 42, 48]. Anything else -> null.
  function rgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex === undefined || hex === null ? '' : hex).trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // grid = rows of colour numbers, all the same length. colours = [[r, g, b] for 0, [r, g, b] for 1, ...].
  // Two colours = 1 bit a pixel (the QR code). More = 8 bits a pixel (18 Nov: the bell's shaded edges).
  // scale = pixels per cell. margin = cells of colour 0 added all round. Gives the PNG as a list of bytes (0 to 255).
  function encode(grid, colours, scale, margin) {
    var cellsHigh = (grid || []).length, cellsWide = cellsHigh ? grid[0].length : 0;
    if (!cellsHigh || !cellsWide || grid.some(function (r) { return r.length !== cellsWide; })) throw new Error('png: the grid must be rows of equal length');
    var depth = colours.length > 2 ? 8 : 1;
    if (grid.some(function (r) { return r.some(function (v) { return !(v >= 0 && v < colours.length); }); })) throw new Error('png: a cell has no colour');
    var width = (cellsWide + 2 * margin) * scale, height = (cellsHigh + 2 * margin) * scale, stride = Math.ceil(width * depth / 8);
    var raw = [], blank = [0];
    for (var b = 0; b < stride; b++) blank.push(0);
    function line(cells) {
      var row = blank.slice();
      for (var c = 0; c < cellsWide; c++) {
        if (!cells[c]) continue;
        for (var x = (c + margin) * scale, end = x + scale; x < end; x++) {
          if (depth === 8) row[1 + x] = cells[c]; else row[1 + (x >> 3)] |= 128 >> (x & 7);
        }
      }
      return row;
    }
    function repeat(row, times) { for (var t = 0; t < times; t++) for (var i = 0; i < row.length; i++) raw.push(row[i]); }
    repeat(blank, margin * scale);
    grid.forEach(function (cells) { repeat(line(cells), scale); });
    repeat(blank, margin * scale);
    return [137, 80, 78, 71, 13, 10, 26, 10].concat(
      chunk('IHDR', u32(width).concat(u32(height), [depth, 3, 0, 0, 0])),   // palette colour
      chunk('PLTE', colours.reduce(function (all, c) { return all.concat(c); }, [])),
      chunk('IDAT', stored(raw)),
      chunk('IEND', []));
  }

  return { encode: encode, rgb: rgb };
})();

if (typeof module !== 'undefined') module.exports = PNG;
// qr.js - our own QR code maker (the pick 18 Nov 2026: our own code, nobody else's service in the middle).
// Makes the square of dark and light cells for a short text such as the sign-up page's address.
// Kept small on purpose: plain "byte" text, error correction level M, sizes 1 to 6 (up to 106 bytes - a page
// address is under 50). Checked against an outside library in test-qr.js. Runs in Apps Script and in Node.
var QR = (function () {
  'use strict';

  // Per size (version 1 to 6) at level M: check bytes per block, and the blocks as [how many, data bytes each].
  var SIZES = [null,
    { ec: 10, blocks: [[1, 16]] }, { ec: 16, blocks: [[1, 28]] }, { ec: 26, blocks: [[1, 44]] },
    { ec: 18, blocks: [[2, 32]] }, { ec: 24, blocks: [[2, 43]] }, { ec: 16, blocks: [[4, 27]] }];
  function dataBytes(v) { return SIZES[v].blocks.reduce(function (n, b) { return n + b[0] * b[1]; }, 0); }

  function utf8(str) {
    var out = [], s = unescape(encodeURIComponent(String(str)));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  // ---- the check bytes (Reed-Solomon over GF(256), polynomial 0x11D) ----
  var EXP = [], LOG = [];
  (function () { var x = 1; for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; } })();
  function mul(a, b) { return (a && b) ? EXP[(LOG[a] + LOG[b]) % 255] : 0; }
  function checkBytes(data, count) {
    var gen = [1], i, j;
    for (i = 0; i < count; i++) {   // multiply the generator by (x - 2^i)
      var next = gen.concat([0]);
      for (j = 0; j < gen.length; j++) next[j + 1] ^= mul(gen[j], EXP[i]);
      gen = next;
    }
    var rem = [];
    for (i = 0; i < count; i++) rem.push(0);
    data.forEach(function (byte) {
      var factor = byte ^ rem.shift();
      rem.push(0);
      for (j = 0; j < count; j++) rem[j] ^= mul(gen[j + 1], factor);
    });
    return rem;
  }

  // ---- text -> the full run of bytes that goes into the square ----
  function codewords(bytes, v) {
    var room = dataBytes(v), bits = [];
    function push(value, n) { for (var i = n - 1; i >= 0; i--) bits.push((value >> i) & 1); }
    push(4, 4); push(bytes.length, 8);
    bytes.forEach(function (b) { push(b, 8); });
    while (bits.length % 8) bits.push(0);   // always 4 zero bits here: they finish the byte and are the standard's end mark
    var data = [];
    for (var i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (var pad = 0; data.length < room; pad++) data.push(pad % 2 ? 0x11 : 0xEC);
    var blocks = [], checks = [], at = 0;
    SIZES[v].blocks.forEach(function (b) {
      for (var n = 0; n < b[0]; n++) { var d = data.slice(at, at + b[1]); at += b[1]; blocks.push(d); checks.push(checkBytes(d, SIZES[v].ec)); }
    });
    var out = [], longest = Math.max.apply(null, blocks.map(function (b) { return b.length; }));
    for (i = 0; i < longest; i++) blocks.forEach(function (b) { if (i < b.length) out.push(b[i]); });
    for (i = 0; i < SIZES[v].ec; i++) checks.forEach(function (c) { out.push(c[i]); });
    return out;
  }

  // ---- the square ----
  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x, y) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return (x * y) % 2 + (x * y) % 3 === 0; },
    function (x, y) { return ((x * y) % 2 + (x * y) % 3) % 2 === 0; },
    function (x, y) { return ((x + y) % 2 + (x * y) % 3) % 2 === 0; }];

  function build(words, v, mask) {
    var size = 17 + 4 * v, grid = [], fixed = [], x, y;
    for (y = 0; y < size; y++) { grid.push([]); fixed.push([]); for (x = 0; x < size; x++) { grid[y].push(0); fixed[y].push(false); } }
    function set(px, py, dark) { grid[py][px] = dark ? 1 : 0; fixed[py][px] = true; }
    function finder(cx, cy) {   // the big corner square with its light border
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var px = cx + dx, py = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (px >= 0 && px < size && py >= 0 && py < size) set(px, py, d !== 2 && d !== 4);
      }
    }
    for (var i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }   // the two dotted lines
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    if (v >= 2) {   // the one small square, near the bottom right
      for (var ay = -2; ay <= 2; ay++) for (var ax = -2; ax <= 2; ax++) set(size - 7 + ax, size - 7 + ay, Math.max(Math.abs(ax), Math.abs(ay)) !== 1);
    }
    // The 15 "format" bits (level M + which mask), written twice. Level M is 00.
    var rem = mask;
    for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    var format = ((mask << 10) | rem) ^ 0x5412;
    function bit(n) { return ((format >> n) & 1) === 1; }
    for (i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
    // The data: two columns at a time from the right, snaking up and down, skipping the dotted column.
    var n = 0, total = words.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var step = 0; step < size; step++) {
        for (var j = 0; j < 2; j++) {
          x = right - j;
          var upward = ((right + 1) & 2) === 0;
          y = upward ? size - 1 - step : step;
          if (fixed[y][x]) continue;
          var dark = n < total && ((words[n >> 3] >> (7 - (n & 7))) & 1) === 1;
          n++;
          grid[y][x] = (dark !== MASKS[mask](x, y)) ? 1 : 0;
        }
      }
    }
    return grid;
  }

  // The standard's score for how hard a square is to read (lower is better). Four rules.
  function penalty(grid) {
    var h = grid.length, w = grid[0].length, score = 0, x, y, dark = 0;
    function runs(get, lines, len) {
      for (var a = 0; a < lines; a++) {
        var run = 1;
        for (var b = 1; b <= len; b++) {
          if (b < len && get(a, b) === get(a, b - 1)) run++;
          else { if (run >= 5) score += 3 + (run - 5); run = 1; }
        }
        for (b = 0; b + 11 <= len; b++) {   // the corner-square look-alike: 1011101 with four light cells on one side
          var s = '';
          for (var k = 0; k < 11; k++) s += get(a, b + k);
          if (s === '10111010000' || s === '00001011101') score += 40;
        }
      }
    }
    runs(function (a, b) { return grid[a][b]; }, h, w);
    runs(function (a, b) { return grid[b][a]; }, w, h);
    for (y = 0; y + 1 < h; y++) for (x = 0; x + 1 < w; x++) {
      var c = grid[y][x];
      if (c === grid[y][x + 1] && c === grid[y + 1][x] && c === grid[y + 1][x + 1]) score += 3;
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) dark += grid[y][x];
    var total = w * h, steps = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    return score + Math.max(0, steps) * 10;
  }

  // text -> rows of 0 (light) and 1 (dark). mask is for the tests; leave it out and the best one is picked.
  function matrix(text, mask) {
    var bytes = utf8(text), v = 1;
    if (!bytes.length) throw new Error('qr: nothing to make a code from');
    while (v <= 6 && bytes.length > dataBytes(v) - 2) v++;   // 2 bytes go on the "plain text" mark and the length
    if (v > 6) throw new Error('qr: the text is too long for the code sizes we make (106 bytes at most)');
    var words = codewords(bytes, v);
    if (mask !== undefined) return build(words, v, mask);
    var best = null, bestScore = Infinity;
    for (var m = 0; m < 8; m++) {
      var g = build(words, v, m), s = penalty(g);
      if (s < bestScore) { best = g; bestScore = s; }
    }
    return best;
  }

  return { matrix: matrix, penalty: penalty };
})();

if (typeof module !== 'undefined') module.exports = QR;
// steps.js - Set up's Firebase steps (18 Nov 2026). ONE list of steps, one truth: the Setup tab's ticks read the
// names from here, and run() does them in this order, stopping at the first that fails with plain words for its tick.
// Running it again carries on: a step that is already done only looks, it does not do the work twice.
//
// It never touches Apps Script or the web itself. The caller hands in "hands" (io):
//   io.call({ method, url, body, raw, project }) -> { code, json }   a web call to Google, naming the owner's project
//   io.get(key) / io.set(key, value) / io.remove(key) / io.keys()    the script's own private storage
//   io.scriptId()        this script's ID          io.sleep(ms)       wait
//   io.random()          64 random hex characters  io.pack(content)   -> { hash, bytes, mark } gzipped for upload;
//                                                                        mark = a fingerprint of the content itself
//   io.watch(minutes)    turn on the watcher and the backup check
//   io.show(url, png)    put the page link and its QR picture on the Setup tab
//   io.wipeDevices()     empty the Devices tab (a copied sheet starts fresh)
// So the whole run is tested offline against a pretend Google (test-steps.js). Every call below was first proven
// live on 17-18 Nov 2026 (HANDOVER.md) except looking up one site by name, which the first live run checks.
// Runs in Apps Script and in Node (for the tests). es256.js, setup.js, png.js and qr.js must come before it.
var STEPS = (function (ES256, SETUP, PNG, QR) {
  'use strict';

  var LIST = [
    { key: 'services', name: 'Switch on services' },
    { key: 'webapp', name: 'Publish as a web app' },
    { key: 'keys', name: 'Make the keys' },
    { key: 'site', name: 'Make the page site' },
    { key: 'page', name: 'Upload the sign-up page' },
    { key: 'watcher', name: 'Turn on the watcher' },
    { key: 'link', name: 'Page link and QR code' }];
  function names() { return LIST.map(function (s) { return s.name; }); }

  // What the script remembers, by name. PFS_SENDING_KEY and PFS_PAGE are the two the sender reads (env-share).
  var P = { SCRIPT: 'PFS_SCRIPT_ID', PROJECT: 'PFS_PROJECT', DEPLOYMENT: 'PFS_DEPLOYMENT', WEBAPP: 'PFS_WEBAPP', DEPLOYED: 'PFS_DEPLOYED',
    KEY: 'PFS_SENDING_KEY', SITE: 'PFS_SITE', PAGE: 'PFS_PAGE', PAGE_SIG: 'PFS_PAGE_SIG', FACTS: 'PFS_FACTS' };
  var OURS = ['PFS_', 'phone_', 'run-sending-'];   // everything a copied sheet must not carry over
  var SERVICES = ['firebasehosting.googleapis.com', 'script.googleapis.com'];
  var SU = 'https://serviceusage.googleapis.com/v1/';
  var SA = 'https://script.googleapis.com/v1/projects/';
  var FH = 'https://firebasehosting.googleapis.com/v1beta1/';
  var ICON_SIZES = [180, 192, 512];

  var OK = { ok: true };
  function fail(words) { return { error: words }; }
  var WAIT = 'Google is still switching the services on. Wait a minute, then run Set up again.';
  var SWITCH_OFF = 'The "Google Apps Script API" switch is off for this Google account. Open https://script.google.com/home/usersettings and turn it On, wait a minute, then run Set up again.';
  // the cold test, 18 Nov: Google wanted its terms for SCRIPTS and our words named the Cloud terms page. The address
  // is now taken out of Google's own answer, so it is always the page Google means (the scripts page if it names none).
  var TERMS_PAGE = 'https://console.developers.google.com/terms/script';
  var ADDRESS = new RegExp('https://[^\\s,)"]*[^\\s,)".]');
  function terms(r) {
    var m = ADDRESS.exec(message(r));
    return 'Google needs you to accept its terms once. Open ' + (m ? m[0] : TERMS_PAGE) + ', click Accept if Google shows the button, then run Set up again.';
  }
  function message(r) { return String((((r || {}).json || {}).error || {}).message || ''); }
  function has(r, words) { return message(r).indexOf(words) >= 0; }
  function notOnYet(r) { return r.code === 403 && (has(r, 'has not been used in project') || has(r, 'is disabled')); }
  function plain(r) { var m = message(r); return 'Google said no (' + r.code + ')' + (m ? ': ' + m.slice(0, 160) : ''); }
  function said(r) { return notOnYet(r) ? WAIT : plain(r); }

  // ---- the steps ----
  var DO = {};

  // 1. Switch on the two Google services the rest needs, in the owner's Firebase project.
  DO.services = function (ctx, io, ask) {
    if (io.get(P.PROJECT) === ctx.project) return OK;
    for (var i = 0; i < SERVICES.length; i++) {
      var r = ask('post', SU + 'projects/' + ctx.project + '/services/' + SERVICES[i] + ':enable', {});
      if (r.code === 400 && has(r, 'terms of service')) return fail(terms(r));
      if ((r.code === 403 && !notOnYet(r)) || r.code === 404 || (r.code === 400 && has(r, 'not found'))) {   // 400 'not found or deleted': cold test 2, 18 Nov
        return fail('Google does not know a Firebase project called "' + ctx.project + '" on this Google account. Open your project in Firebase, copy the address from the address bar and paste it into "' + SETUP.PROJECT_LABEL + '" on Setup.');
      }
      if (r.code !== 200) return fail(plain(r));
      var job = r.json.name, done = !job || !!r.json.done;
      for (var n = 0; !done && n < 12; n++) { io.sleep(5000); done = !!ask('get', SU + job).json.done; }
      if (!done) return fail(WAIT);
    }
    io.set(P.PROJECT, ctx.project);
    return OK;
  };

  // 2. Publish this script as a web app (what the sign-up page talks to). The first time makes it; every time
  //    after puts the new code into the SAME web app, so its address never changes under signed-up devices.
  DO.webapp = function (ctx, io, ask, facts) {
    var base = SA + io.scriptId();
    // The switch being off can show at the first look OR only when the script tries to publish (seen live 18 Nov).
    var no = function (r) {
      if (r.code === 403 && has(r, 'not enabled the Apps Script API')) { facts.apiSwitch = false; return fail(SWITCH_OFF); }
      return fail(said(r));
    };
    var look = ask('get', base);
    if (look.code !== 200) return no(look);
    facts.apiSwitch = true;
    if (io.get(P.DEPLOYMENT) && io.get(P.WEBAPP) && io.get(P.DEPLOYED) === ctx.version) return OK;
    var label = 'Push from sheet ' + ctx.version;
    var v = ask('post', base + '/versions', { description: label });
    if (v.code !== 200) return no(v);
    var number = v.json.versionNumber, had = io.get(P.DEPLOYMENT), d = null;
    if (had) {
      d = ask('put', base + '/deployments/' + had, { deploymentConfig: { versionNumber: number, manifestFileName: 'appsscript', description: label, scriptId: io.scriptId() } });
      if (d.code === 404) d = null;   // deleted by hand: make a new one
    }
    if (!d) d = ask('post', base + '/deployments', { versionNumber: number, manifestFileName: 'appsscript', description: label });
    if (d.code !== 200) return no(d);
    var web = (d.json.entryPoints || []).filter(function (e) { return e.entryPointType === 'WEB_APP'; })[0];
    var url = web && web.webApp && web.webApp.url;
    if (!url || !d.json.deploymentId) return fail('Google published the script but gave no web app address. Check that appsscript.json still has its "webapp" part, then run Set up again.');
    io.set(P.DEPLOYMENT, d.json.deploymentId); io.set(P.WEBAPP, url); io.set(P.DEPLOYED, ctx.version);
    return OK;
  };

  // 3. This sheet's own sending key. Made once, never changed (changing it would cut off every signed-up device).
  DO.keys = function (ctx, io) {
    if (io.get(P.KEY)) return OK;
    var hex = String(io.random()).toLowerCase();
    try { ES256.readKey(hex); } catch (e) { return fail('Could not make a sending key (' + e.message + '). Run Set up again.'); }
    io.set(P.KEY, hex);
    return OK;
  };

  // 4. This sheet's own page site inside the owner's project (one project can hold a site per sheet - proven 18 Nov).
  DO.site = function (ctx, io, ask) {
    var have = io.get(P.SITE);
    if (have) {
      var look = ask('get', FH + 'projects/' + ctx.project + '/sites/' + have);
      if (look.code === 200) return OK;
      if (look.code !== 404) return fail(said(look));
    }
    var last = null;
    for (var n = 0; n < 3; n++) {
      var want = siteId(ctx.appName, String(io.random()).slice(0, 6));
      var r = ask('post', FH + 'projects/' + ctx.project + '/sites?siteId=' + want, {});
      if (r.code === 200) { io.set(P.SITE, want); io.remove(P.PAGE); io.remove(P.PAGE_SIG); return OK; }
      if (r.code !== 400 && r.code !== 409) return fail(said(r));
      last = r;   // not allowed, or somebody else has it: try another
    }
    return fail('Google would not give this sheet a page address after 3 tries. It said: ' + message(last).slice(0, 160));
  };

  // 5. Put the sign-up page on that site, carrying this sheet's web app address, key, name, colour and icon.
  DO.page = function (ctx, io, ask) {
    var site = io.get(P.SITE), url = 'https://' + site + '.web.app/';
    var files = pageFiles(ctx, { script: io.get(P.WEBAPP), publicKey: ES256.b64url(ES256.publicKey(io.get(P.KEY))) });
    var hashes = {}, bodies = {}, marks = [site];
    Object.keys(files).sort().forEach(function (path) {
      var packed = io.pack(files[path]);
      hashes['/' + path] = packed.hash; bodies[packed.hash] = packed.bytes; marks.push(path + ':' + packed.mark);
    });
    var sig = marks.join('|');
    if (io.get(P.PAGE) === url && io.get(P.PAGE_SIG) === sig) return OK;   // exactly this page is already up
    var v = ask('post', FH + 'sites/' + site + '/versions', {});
    if (v.code !== 200) return fail(said(v));
    var list = ask('post', FH + v.json.name + ':populateFiles', { files: hashes });
    if (list.code !== 200) return fail(said(list));
    var need = list.json.uploadRequiredHashes || [];
    for (var i = 0; i < need.length; i++) {
      var up = ask('post', list.json.uploadUrl + '/' + need[i], undefined, bodies[need[i]]);
      if (up.code !== 200) return fail(said(up));
    }
    var fin = ask('patch', FH + v.json.name + '?update_mask=status', { status: 'FINALIZED' });
    if (fin.code !== 200) return fail(said(fin));
    var rel = ask('post', FH + 'sites/' + site + '/releases?versionName=' + v.json.name, {});
    if (rel.code !== 200) return fail(said(rel));
    io.set(P.PAGE, url); io.set(P.PAGE_SIG, sig);
    return OK;
  };

  // 6. The watcher (sends when a row arrives) and the backup check, at the minutes chosen on Setup.
  DO.watcher = function (ctx, io) {
    try { io.watch(ctx.backupMinutes); } catch (e) { return fail('The watcher could not be turned on: ' + (e && e.message ? e.message : e)); }
    return OK;
  };

  // 7. The page's address and its QR code, on the Setup tab.
  DO.link = function (ctx, io) {
    var url = io.get(P.PAGE);
    io.show(url, qrPicture(url));
    return OK;
  };
  // Black on white, 6 pixels a cell, with the 4 cells of white round it that the standard asks for.
  function qrPicture(url) { return PNG.encode(QR.matrix(url), [[255, 255, 255], [0, 0, 0]], 6, 4); }

  // ---- the run ----
  // A copied sheet may carry the first sheet's private storage. It is a copy when the script it remembers is not itself.
  function isCopy(io) { var was = io.get(P.SCRIPT); return !!was && was !== io.scriptId(); }

  // ctx = { project, appName, colour, backupMinutes, version, files: { 'index.html': text, 'sw.js': text } }.
  // Gives facts = { apiSwitch, steps: { 'step name': { ok: true } | { error: 'words' } }, page (when all done), fresh }.
  function run(ctx, io) {
    var facts = { steps: {} }, fresh = isCopy(io);
    if (fresh) {
      io.keys().forEach(function (k) { if (OURS.some(function (start) { return k.indexOf(start) === 0; })) io.remove(k); });
      io.wipeDevices();
    }
    io.set(P.SCRIPT, io.scriptId());
    var ask = function (method, url, body, raw) { return io.call({ method: method, url: url, body: body, raw: raw, project: ctx.project }); };
    var allDone = true;
    for (var i = 0; i < LIST.length; i++) {
      var r;
      try { r = DO[LIST[i].key](ctx, io, ask, facts); } catch (e) { r = fail('Something unexpected stopped this step: ' + (e && e.message ? e.message : e)); }
      facts.steps[LIST[i].name] = r.error ? { error: r.error } : { ok: true };
      if (r.error) { allDone = false; break; }
    }
    if (allDone) facts.page = io.get(P.PAGE);
    io.set(P.FACTS, JSON.stringify(facts));
    facts.fresh = fresh;
    return facts;
  }

  // What the last run found, for drawing the ticks at any later time.
  function facts(io) {
    var f = {};
    try { f = JSON.parse(io.get(P.FACTS) || '{}') || {}; } catch (e) { f = {}; }
    if (!f.steps) f.steps = {};
    return f;
  }

  // What Set up says to the owner when it ends.
  // Every step done and a page to share: Set up then opens the share box (ruling A, 18 Nov 9pm).
  function finished(f) {
    if (!f || !f.page) return false;
    return LIST.every(function (s) { var r = (f.steps || {})[s.name]; return !!(r && r.ok); });
  }

  function summary(f) {
    var lead = f.fresh ? 'This sheet is a copy, so it started fresh with its own page and no devices. ' : '';
    for (var i = 0; i < LIST.length; i++) {
      var r = (f.steps || {})[LIST[i].name];
      if (r && r.error) return lead + 'Stopped at step ' + (i + 1) + ' of ' + LIST.length + ' (' + LIST[i].name + '). ' + r.error;
    }
    // Finished: Set up opens the share box with the QR (18 Nov 9pm), so these words only lead into it.
    if (f.page) return lead + 'All done. Open the sign-up page on each phone or computer and turn on notifications.';
    return lead + 'Set up has not finished. Run Set up again.';
  }

  // ---- the page's address, files and icon ----
  var NOT_PLAIN = new RegExp('[^a-z0-9]+', 'g'), END_DASHES = new RegExp('^-+|-+$', 'g'), LETTER_FIRST = new RegExp('^[a-z]');
  // 'Smith Cutting' + 'a1b2c3' -> 'smith-cutting-a1b2c3': the page lives at https://smith-cutting-a1b2c3.web.app/
  function siteId(appName, rand) {
    var slug = String(appName || '').toLowerCase().replace(NOT_PLAIN, '-').replace(END_DASHES, '');
    if (!LETTER_FIRST.test(slug)) slug = slug ? 'push-' + slug : 'push';
    return slug.slice(0, 20).replace(END_DASHES, '') + '-' + rand;
  }

  // The plain default icon: a bell, as a size-by-size grid of shades 0 (the owner's colour) to 16 (white).
  // Each cell is sampled 4 x 4 times, so the edges come out shaded, not stepped (18 Nov: jagged on the iPhone).
  // Kept clear of the edges, because phones round an icon's corners.
  function bellAt(u, v) {
    var du = Math.abs(u - 0.5);
    function disc(a, b, r) { return a * a + b * b <= r * r; }
    if (disc(du, v - 0.2, 0.035)) return true;                                   // the loop on top
    if (v <= 0.4) return disc(du, v - 0.4, 0.17);                                 // the dome
    if (v <= 0.66) return du <= 0.17 + (v - 0.4) / 0.26 * 0.065;                  // the flare
    if (v <= 0.715) return du <= 0.2475 || disc(du - 0.2475, v - 0.6875, 0.0275);  // the rim, round ends
    return disc(du, v - 0.745, 0.055);                                            // the clapper
  }
  function icon(size) {
    var grid = [];
    for (var y = 0; y < size; y++) {
      var row = [];
      for (var x = 0; x < size; x++) {
        var hits = 0;
        for (var sy = 0; sy < 4; sy++) for (var sx = 0; sx < 4; sx++) {
          if (bellAt((x + (sx + 0.5) / 4) / size, (y + (sy + 0.5) / 4) / size)) hits++;
        }
        row.push(hits);
      }
      grid.push(row);
    }
    return grid;
  }


  // ctx as for run(); cfg = { script: the web app's address, publicKey }. Gives { 'file name': text or list of bytes }.
  function pageFiles(ctx, cfg) {
    var colour = PNG.rgb(ctx.colour) ? String(ctx.colour).trim() : SETUP.DEFAULT_COLOUR;
    var name = String(ctx.appName || '');
    var files = { 'index.html': ctx.files['index.html'], 'sw.js': ctx.files['sw.js'] };
    // '<' is written as its code so a name can never close the page's script tag early.
    files['config.js'] = '// Written by Set up (Push from sheet). The two things this page needs, and the owner\'s name and colour.\n' +
      'var CONFIG = ' + JSON.stringify({ script: cfg.script, publicKey: cfg.publicKey, name: name, colour: colour }).split('<').join('\\u003c') + ';\n';
    files['manifest.json'] = JSON.stringify({ name: name, short_name: name, start_url: './', scope: './', display: 'standalone',
      background_color: '#ffffff', theme_color: colour,
      icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }] }, null, 2);
    var base = PNG.rgb(colour), shades = [];
    for (var n = 0; n <= 16; n++) shades.push(base.map(function (c) { return Math.round(c + (255 - c) * n / 16); }));   // owner colour -> white
    ICON_SIZES.forEach(function (size) { files['icon-' + size + '.png'] = PNG.encode(icon(size), shades, 1, 0); });
    return files;
  }

  return { names: names, run: run, facts: facts, summary: summary, finished: finished, isCopy: isCopy, siteId: siteId, pageFiles: pageFiles, icon: icon, qrPicture: qrPicture, PROPS: P };
})(typeof ES256 !== 'undefined' ? ES256 : require('./es256.js'),
   typeof SETUP !== 'undefined' ? SETUP : require('./setup.js'),
   typeof PNG !== 'undefined' ? PNG : require('./png.js'),
   typeof QR !== 'undefined' ? QR : require('./qr.js'));

if (typeof module !== 'undefined') module.exports = STEPS;
// setuptab.js - decides what goes in each cell of the owner's Setup tab (look B, the pick 17 Nov 2026) and its dropdowns.
// 18 Nov: as little typing as possible. The script fills in what it can (app name = the sheet's name, the tab when
// there is only one, a Push To column if there is one) and offers the rest as picks. Running it again keeps everything
// the owner already filled in, wherever those rows were. SETUP.read (setup.js) reads the result back by label.
// It never touches Apps Script: the caller hands in the sheet's name, tab names, header rows and the tab as it is now.
// Runs in Apps Script and in Node (for the tests).

// setup.js and steps.js must come before this file in the paste file (build.py), so SETUP and STEPS are there in Apps Script.
var SETUPTAB = (function (SETUP, STEPS) {
  'use strict';

  // One truth, one place: the reading rules, Notified, the app-name limit and the backup choices all come from setup.js,
  // and the Set up steps (their names and order) from steps.js.
  var STEP_NAMES = STEPS.names();
  var NOT_YET = '–  Not yet';
  var TERMS_LABEL = 'Apps Script terms', TERMS_URL = 'https://console.developers.google.com/terms/script';
  var ADDRESS = new RegExp('https://[^\\s,)"]*[^\\s,)".]');   // an address inside a sentence, without the full stop after it
  var OWN_TABS = ['Setup', 'Devices', 'Phones'];   // the script's own tabs (Phones = the old name): never offered as the tab with the rows
  var pairs = SETUP.pairs;

  function text(v) { return (v === undefined || v === null) ? '' : String(v).trim(); }
  function minutes(n) { return n ? n + ' minutes' : 'Off'; }

  // book = { name, tabs: [names], headers: { tab: [header cells] } }. current = the Setup tab's displayed values now ([] if new).
  // Gives { rows: [[A, B, C, D, E]], kinds: [one per row, for the drawing], dropdowns: [{ row, list, strict }], links: [{ row, col, url, text }] }. Rows count from 1.
  function build(book, current, facts) {
    var had = pairs(current);
    var keep = function (label, fallback) { return (label in had) ? had[label] : fallback; };
    var ownerTabs = ownerTabsOf(book.tabs || []);

    var project = [SETUP.PROJECT_LABEL].concat(SETUP.OLD_PROJECT_LABELS).reduceRight(function (v, l) { return keep(l, v); }, '');
    // The suggestion is the sheet's name without Google's "Copy of " in front (18 Nov).
    var sheetName = text(book.name).replace(/^copy of\s+(?=\S)/i, '');
    var appName = keep('App name', sheetName.slice(0, SETUP.MAX_APP_NAME));
    var tab = keep('Tab with your rows', ownerTabs.length === 1 ? ownerTabs[0] : '');
    var cols = ((book.headers || {})[tab] || []).map(text).filter(function (h) { return h !== '' && h !== SETUP.NOTIFIED; });
    var pushToGuess = cols.filter(function (h) { return h.toLowerCase() === 'push to'; })[0] || '';

    var rows = [], kinds = [], dropdowns = [], links = [];
    var add = function (kind, b, c, d) { rows.push(['', b || '', c === undefined ? '' : c, d || '', '']); kinds.push(kind); return rows.length; };
    var pick = function (row, list, strict) { if (list.length) dropdowns.push({ row: row, list: list, strict: strict }); };
    // Column dropdowns read the tab's heading row itself (18 Nov), so a renamed heading shows at once.
    var pickCol = function (row, strict) { if (cols.length) dropdowns.push({ row: row, list: cols, strict: strict, fromHeader: tab }); return row; };
    // the cold test as a stranger, 18 Nov: with two Google accounts signed in, a plain link opens in the FIRST one.
    // When the sheet's owner is known, every Google link names that account.
    var owner = text(book.owner);
    var asOwner = function (url) { return owner ? url + (url.indexOf('?') < 0 ? '?' : '&') + 'authuser=' + encodeURIComponent(owner) : url; };
    // 18 Nov 9:15pm: one way only, no confusion - copy the address bar, paste it in.
    var firebaseHelp = 'Open Firebase ›  Make a project (any name). Switch off the Developer Program, Gemini and Analytics - not needed. Open the project, copy the address from the address bar and paste it here.';
    var termsHelp = 'Open the terms ›  Click Accept if Google shows the button. Once per Google account.';   // cold test 2: a new account gets a button
    var switchHelp = 'Open the switch ›  Turn it On.';
    // The message: up to three single picks. An old comma list in one cell is spread across them (a fourth stays in the third).
    var said = SETUP.MESSAGE_LABELS.map(function (l) { return keep(l, ''); }).join(',').split(',').map(text).filter(function (m) { return m !== ''; });
    var messages = [said[0] || '', said[1] || '', said.slice(2).join(', ')];

    add('band'); add('title', appName); add('subtitle', 'Push from sheet  ·  free push notifications to phones and computers'); add('band');
    rows.push(['', 'Firebase project', 'Apps Script API', 'Your settings', 'Set up']); kinds.push('statushead');
    rows.push(['', NOT_YET, NOT_YET, NOT_YET, NOT_YET]); kinds.push('status');
    add('gap');
    add('section', '1   Once per Google account');
    add('note', 'Signed in to more than one Google account? Check the picture at the top right of each page you open is this sheet\'s owner.');
    var r = add('setting', SETUP.PROJECT_LABEL, project, firebaseHelp), projectRow = r;
    links.push({ row: r, col: 4, url: asOwner('https://console.firebase.google.com/'), text: firebaseHelp });
    r = add('setting', TERMS_LABEL, 'Open once', termsHelp); var termsRow = r;
    links.push({ row: r, col: 4, url: asOwner(TERMS_URL), text: termsHelp });
    r = add('setting', '"Google Apps Script API" switch', 'Not checked', switchHelp); var switchRow = r;
    links.push({ row: r, col: 4, url: asOwner('https://script.google.com/home/usersettings'), text: switchHelp });
    add('gap');
    add('section', '2   Your settings');
    var appNameRow = add('setting', 'App name', appName, 'The name on phones and computers, ' + SETUP.MAX_APP_NAME + ' characters at most. Starts as the sheet\'s name - change it to your business name');
    var colourRow = add('setting', 'Colour', keep('Colour', SETUP.DEFAULT_COLOUR_NAME), 'Pick a colour, or type a code like ' + SETUP.DEFAULT_COLOUR);
    pick(colourRow, Object.keys(SETUP.COLOURS), false);
    pick(add('setting', 'Tab with your rows', tab, 'The tab your rows are added to, by hand or by your app'), ownerTabs, true);
    var appsheet = keep(SETUP.APPSHEET_LABEL, 'No');
    pick(add('setting', SETUP.APPSHEET_LABEL, appsheet, 'Yes: your tab is moved first at Set up, because AppSheet builds a new app from the first tab'), ['No', 'Yes'], true);
    var titleRow = pickCol(add('setting', 'Title column', keep('Title column', ''), 'The bold first line of the notification'), true);
    var messageHelp = ['The line under the title', 'Optional. Added after it, with a comma', 'Optional. Added after that'];
    var messageRows = SETUP.MESSAGE_LABELS.map(function (l, i) { return pickCol(add('setting', l, messages[i], messageHelp[i]), true); });
    // A blank Push To is filled whenever the tab has a Push To column: blank cells in that column still mean every phone,
    // so filling it never changes who gets what (live 12:46: a blank left by a first draw with no tab stuck).
    var pushToRow = pickCol(add('setting', 'Push To column', keep('Push To column', '') || pushToGuess, 'Optional. A column of names or emails from the Devices tab. A blank cell sends to every device you let in'), true);
    var linkRow = pickCol(add('setting', 'Link to open', keep('Link to open', ''), 'Optional. A column of web links, one per row. Tapping the notification opens that row\'s link, like its AppSheet record. Blank opens the sign-up page'), true);
    pick(add('setting', SETUP.LINKS_LABEL, keep(SETUP.LINKS_LABEL, SETUP.LINKS_GOOGLE), 'AppSheet and Google only is the safe one. Any website only if only your own staff can add rows'), [SETUP.LINKS_GOOGLE, SETUP.LINKS_ANY], true);
    // 18 Nov: starts from the AppSheet answer (AppSheet adds a whole row in one go), then it is the owner's pick.
    pick(add('setting', SETUP.WAIT_LABEL, keep(SETUP.WAIT_LABEL, SETUP.waitDefault(appsheet.toLowerCase() === 'yes')), 'Time to finish typing a row before it is sent. Off sends at once - best when AppSheet adds the rows'), SETUP.WAIT_CHOICES, true);
    pick(add('setting', 'Sign-ups', keep('Sign-ups', 'Approve'), 'Approve: a new device waits for your tick on the Devices tab. Open: anyone with the link gets in'), ['Approve', 'Open'], true);
    pick(add('setting', 'Backup check', keep('Backup check', minutes(SETUP.BACKUP_DEFAULT)), 'Sends any row Google missed. After changing it, run Set up again'),
      [minutes(0)].concat(SETUP.BACKUP_CHOICES.map(minutes)), true);
    add('gap');
    add('section', '3   Set up        Menu: Push from sheet  ›  Set up');
    add('note', 'Google asks you to allow it. "Google hasn\'t verified this app" is normal - it is your own copy, and the developer it names is you. Click Advanced › Go to Push from sheet, tick Select all, then Continue.');
    STEP_NAMES.forEach(function (step) { add('step', step); });   // ticks() below writes each step's words
    add('gap');
    // After Set up the page's address is here as a link, and the drawing puts its QR code on this row.
    var pageUrl = text((facts || {}).page), pageRow = add('phonepage', 'Sign-up page', pageUrl || 'Appears here after Set up');
    if (pageUrl) links.push({ row: pageRow, col: 3, url: pageUrl, text: pageUrl });
    add('gap');
    add('section', 'Good to know');
    add('note', 'Daily allowance is Google\'s, shared by all your scripts. The backup check uses about 11 minutes a day at 10 minutes.');
    add('note', 'iPhone: add the page to the Home Screen first, then turn on.');
    add('note', 'Anyone who can add a row to your tab can send a notification. Only let people you trust add rows.');
    add('note', 'To stop for good: Push from sheet › Turn off, then bin the sheet.');
    add('note', 'Free, as is, MIT licence  ·  ' + SETUP.REPO + '  ·  version ' + SETUP.VERSION);
    rows[1][1] = '=C' + appNameRow;   // the heading shows the App name cell, so it follows as the owner types (18 Nov)
    var tones = ticks(rows, facts || {});
    // The empty project box stands out until it is filled (cold test 2: the owner typed into the yellow status box instead).
    if (text(project) === '') tones.push({ row: projectRow, col: 3, tone: 'need' });
    // A status box that asks you to do something is itself the link (cold test 2: the owner clicked the yellow box).
    if (text(rows[termsRow - 1][2]).charAt(0) === '!') links.push({ row: termsRow, col: 3, url: asOwner(TERMS_URL), text: rows[termsRow - 1][2] });
    if (text(rows[switchRow - 1][2]).charAt(0) === '!') links.push({ row: switchRow, col: 3, url: asOwner('https://script.google.com/home/usersettings'), text: rows[switchRow - 1][2] });
    // The boxes Set up fills in are locked with a warning (the drawing protects them), so typing there is caught.
    // As few ranges as possible: each lock is a slow call to Google (18 Nov: 10 locks took seconds).
    var locked = [{ row: 6, col: 2, rows: 1, cols: 4 }];
    if (switchRow === termsRow + 1) locked.push({ row: termsRow, col: 3, rows: 2, cols: 1 });
    else locked.push({ row: termsRow, col: 3, rows: 1, cols: 1 }, { row: switchRow, col: 3, rows: 1, cols: 1 });
    kinds.forEach(function (k, i) {
      if (k !== 'step') return;
      var last = locked[locked.length - 1];
      if (last.col === 3 && last.cols === 2 && last.row + last.rows === i + 1) last.rows++;
      else locked.push({ row: i + 1, col: 3, rows: 1, cols: 2 });
    });
    // A picked column that is no longer a heading on the tab (renamed or deleted): amber, with what to do.
    var known = (book.headers || {})[tab], stale = [];
    if (tab && known) {
      [[titleRow, false]].concat(messageRows.map(function (m) { return [m, true]; }), [[pushToRow, false], [linkRow, false]]).forEach(function (c) {
        var r = c[0] - 1, picked = text(rows[r][2]);
        if (picked === '') return;
        var gone = (c[1] ? picked.split(',') : [picked]).map(text).filter(function (n) { return n !== '' && cols.indexOf(n) < 0; });
        if (!gone.length) return;
        rows[r][3] = '"' + gone[0] + '" is not a heading on ' + tab + ' any more - pick again';
        stale.push(rows[r][1] + ': ' + rows[r][3] + '.');   // also stops Set up before the steps (18 Nov)
        tones.push({ row: c[0], col: 3, tone: 'amber' });
      });
    }
    // Any address in a failed step's reason is a real link (18 Nov: "this isn't clickable"), in the owner's account.
    STEP_NAMES.forEach(function (name) {
      for (var i = 0; i < rows.length; i++) {
        if (rows[i][1] !== name) continue;
        var m = ADDRESS.exec(text(rows[i][3]));
        if (m) links.push({ row: i + 1, col: 4, url: asOwner(m[0]), text: rows[i][3], start: m.index, end: m.index + m[0].length });
      }
    });
    var built = { rows: rows, kinds: kinds, dropdowns: dropdowns, links: links, tones: tones, colourRow: colourRow, stale: stale, locked: locked };
    if (pageUrl) built.page = { row: pageRow, url: pageUrl };
    built.share = sharePanel(pageUrl);
    return built;
  }

  // The ticks (look B mock-up rows 6 and 24-29). Always worked out fresh from the settings and what Set up last did -
  // never copied from the old tab. facts = { apiSwitch: true | false | undefined, steps: { 'step name': { ok: true } | { error: 'words' } } }.
  // Writes the words into rows and gives back [{ row, col, tone }] with tone green / amber / red / grey for the drawing.
  // The share panel: once the page exists, a box to the right of the card (column G; F is a gap) with the QR code,
  // so the first thing you see when it is LIVE is how to get people signed up (18 Nov). The QR picture is
  // placed over rows 4 to 10 (pfsPlaceQr_); the drawing styles each cell by its kind.
  function sharePanel(url) {
    if (!url) return null;
    return { col: 7, width: 300, top: 2, bottom: 12, qr: { row: 4, col: 7, size: 150 },   // QR over rows 4-10; the link fits on one line
      cells: [{ row: 2, kind: 'sharetitle', text: 'Share the sign-up page' },
              { row: 3, kind: 'sharehelp', text: 'Scan with a phone camera, or send the link.' },
              { row: 11, kind: 'sharelink', text: url, url: url },
              { row: 12, kind: 'sharehelp', text: 'Menu: Push from sheet  ›  Share the sign-up page' }] };
  }

  function ticks(rows, facts) {
    var tones = [], steps = facts.steps || {};
    var at = function (label) { for (var i = 0; i < rows.length; i++) if (rows[i][1] === label) return i; return -1; };
    var put = function (i, col, words, tone) { rows[i][col - 1] = words; tones.push({ row: i + 1, col: col, tone: tone }); };
    var read = SETUP.read(rows), missing = read.problems.length;
    var nameMissing = read.problems.some(function (p) { return p.indexOf('Firebase project') === 0; });

    var done = 0, failed = 0;
    STEP_NAMES.forEach(function (name, n) {
      var i = at(name), r = steps[name];
      if (i < 0) return;
      if (r && r.ok) { done++; put(i, 3, '✓  Done', 'green'); }
      else if (r && r.error) { if (!failed) failed = n + 1; put(i, 3, '✕  Failed', 'red'); put(i, 4, r.error, 'red'); }
      else put(i, 3, NOT_YET, 'grey');
    });
    // The terms cannot be asked about, but the first step only gets through once they are accepted.
    var first = steps[STEP_NAMES[0]], terms = at(TERMS_LABEL);
    if (terms >= 0) {
      if (first && first.ok) put(terms, 3, '✓  Done', 'green');
      else if (first && first.error && first.error.indexOf('terms') >= 0) put(terms, 3, '!  Open the terms', 'amber');
    }
    var sw = at('"Google Apps Script API" switch');
    if (facts.apiSwitch === true) put(sw, 3, '✓  On', 'green');
    else if (facts.apiSwitch === false) put(sw, 3, '!  Off', 'amber');

    var head = 5;   // row 6: Firebase project, Apps Script API, Your settings, Set up
    if (nameMissing) put(head, 2, '!  Needs your project address', 'amber');
    else if (steps[STEP_NAMES[0]] && steps[STEP_NAMES[0]].ok) put(head, 2, '✓  Done', 'green');
    else put(head, 2, NOT_YET, 'grey');
    if (facts.apiSwitch === true) put(head, 3, '✓  On', 'green');
    else if (facts.apiSwitch === false) put(head, 3, '!  Switch it on', 'amber');
    else put(head, 3, '–  Not checked', 'grey');
    if (missing) put(head, 4, '!  ' + missing + ' to fill in', 'amber'); else put(head, 4, '✓  Filled in', 'green');
    if (failed) put(head, 5, '✕  Step ' + failed + ' failed', 'red');
    else if (done === STEP_NAMES.length) { put(head, 5, '✓  Done', 'green'); put(1, 5, '●  LIVE', 'live'); }
    else if (done) put(head, 5, '!  Run Set up again', 'amber');
    else put(head, 5, NOT_YET, 'grey');
    return tones;
  }

  // A copy of a sheet that was set up: keep the owner's picks, but not the Firebase project (it belongs to whoever set
  // up the original). Drawn with no facts, it shows as not set up: no LIVE, no link, no QR (18 Nov).
  function forCopy(grid) {
    return (grid || []).map(function (r) {
      var row = (r || []).slice();
      if ([SETUP.PROJECT_LABEL].concat(SETUP.OLD_PROJECT_LABELS).indexOf(text(row[1])) >= 0) row[2] = '';
      return row;
    });
  }

  // The settings the owner changed between Set up reading the tab and drawing it (cold test 2, 18 Nov: a 52 second run
  // drew over a project name typed while it ran). Set up draws from a fresh read and says these need another run.
  function typedDuring(before, now) {
    var a = pairs(before || []), b = pairs(now || []), out = [];
    Object.keys(b).forEach(function (label) { if (text(b[label]) !== text(a[label])) out.push(label); });
    Object.keys(a).forEach(function (label) { if (!(label in b) && text(a[label]) !== '') out.push(label); });
    return out;
  }

  // Is this tab ours to draw on? Yes when it is empty, or its subtitle (row 3, column B) starts with 'Push from sheet'.
  // Set up never draws over somebody else's tab that happens to be called Setup.
  function isOurs(grid) {
    var any = (grid || []).some(function (r) { return (r || []).some(function (c) { return text(c) !== ''; }); });
    return !any || text(((grid || [])[2] || [])[1]).indexOf('Push from sheet') === 0;
  }

  function ownerTabsOf(tabs) { return tabs.filter(function (t) { return OWN_TABS.indexOf(t) < 0; }); }

  // The owner's tab is remembered by Google's own ID for it (18 Nov), so renaming it never loses it.
  // wanted = the name on Setup, storedId = the ID remembered last time, tabs = [{ name, id }].
  // Gives { name, id, renamed }: the tab to use, its ID to remember, and whether Setup should show the new name.
  function followTab(wanted, storedId, tabs) {
    var byName = tabs.filter(function (t) { return t.name === wanted; })[0];
    if (byName) return { name: byName.name, id: byName.id, renamed: false };
    var byId = storedId === null || storedId === undefined ? null : tabs.filter(function (t) { return t.id === storedId; })[0];
    if (byId) return { name: byId.name, id: byId.id, renamed: true };
    return { name: wanted, id: null, renamed: false };
  }

  // The owner just edited a Setup cell (row, col from 1). When it is the AppSheet answer, the wait follows it: Yes = Off,
  // No = 30 seconds - but only when the wait still holds the other answer's starting value, so a wait the owner picked
  // (1 minute) is never touched. Gives { row, col, value } to write, or null.
  function afterEdit(rows, row, col) {
    var label = function (r) { return String((rows[r] || [])[1] || '').trim(); }, at = -1, i;
    if (col !== 3 || label(row - 1) !== SETUP.APPSHEET_LABEL) return null;
    var answer = String(rows[row - 1][2] || '').trim().toLowerCase();
    if (answer !== 'yes' && answer !== 'no') return null;
    for (i = 0; i < rows.length; i++) if (label(i) === SETUP.WAIT_LABEL) at = i;
    if (at < 0) return null;
    var wait = String(rows[at][2] || '').trim().toLowerCase(), want = SETUP.waitDefault(answer === 'yes'), other = SETUP.waitDefault(answer !== 'yes');
    return wait === other.toLowerCase() ? { row: at + 1, col: 3, value: want } : null;
  }

  // Set up applies the onEdit rule for Yes too (19 Nov: in a brand-new copy, edits typed during the first-open redraw
  // lost their onEdit, so Yes left Wait at 30 seconds). Only Yes -> Off: an Off the owner chose with No is theirs.
  // Gives a copy of the rows; the rows given are not changed.
  function waitFollows(rows) {
    var out = rows.map(function (r) { return (r || []).slice(); }), i;
    for (i = 0; i < out.length; i++) {
      if (String(out[i][1] || '').trim() !== SETUP.APPSHEET_LABEL || String(out[i][2] || '').trim().toLowerCase() !== 'yes') continue;
      var change = afterEdit(out, i + 1, 3);
      if (change) out[change.row - 1][change.col - 1] = change.value;
    }
    return out;
  }

  return { build: build, forCopy: forCopy, typedDuring: typedDuring, afterEdit: afterEdit, waitFollows: waitFollows, isOurs: isOurs, followTab: followTab, ownerTabs: ownerTabsOf, TAB_NAME: 'Setup' };
})(typeof SETUP !== 'undefined' ? SETUP : require(process.env.SETUP || './setup.js'),
   typeof STEPS !== 'undefined' ? STEPS : require('./steps.js'));

if (typeof module !== 'undefined') module.exports = SETUPTAB;
// menu.js - the 'Push from sheet' menu in the owner's sheet (SPEC_V1): Set up, Send me a test, Check for update, Turn off.
// What each item says to the owner, and the small decisions behind them. It never touches Apps Script: the bound
// script's glue calls these and shows the words. Check for update only reads a version number - it never changes code.
// setup.js must come before this file in the paste file (build.py), so SETUP is there in Apps Script.
// Runs in Apps Script and in Node (for the tests).

var MENU = (function (SETUP) {
  'use strict';

  var TITLE = 'Push from sheet';
  var OWN_TRIGGERS = ['runOnChange', 'runTimer'];   // the watcher and the backup check - Turn off removes only these
  var VERSION = SETUP.VERSION;                       // one truth: setup.js
  var KEPT = 'Your devices and settings are kept - Set up turns it back on.';

  function items() {
    return [{ name: 'Set up', fn: 'pfsSetUp' }, { name: 'Share the sign-up page', fn: 'pfsShare' }, { name: 'Send me a test', fn: 'pfsSendTest' },
      { name: 'Check for update', fn: 'pfsCheckUpdate' }, { name: 'Turn off', fn: 'pfsTurnOff' }];
  }

  function esc(t) { return String(t === undefined || t === null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // The Share box (18 Nov: make the link and QR code easy to share): the QR big, the address, a Copy button.
  // pngB64 = the QR picture as base64. Shown by the bound script in a box over the sheet.
  // lead = an optional first line: Set up's "All done" when it opens this box at the end (ruling A, 18 Nov 9pm).
  function shareHtml(url, pngB64, appName, colour, lead) {
    var c = /^#[0-9A-Fa-f]{6}$/.test(String(colour || '')) ? colour : SETUP.DEFAULT_COLOUR, u = esc(url);
    return '<div style="font:15px/1.4 Roboto,Arial,sans-serif;text-align:center;color:#1F2023">' +
      (lead ? '<p style="margin:0 0 10px;font-weight:600">' + esc(lead) + '</p>' : '') +
      '<div style="font-size:18px;font-weight:700;margin:4px 0 12px">' + esc(appName) + '</div>' +
      '<img alt="QR code" style="width:240px;height:240px;image-rendering:pixelated" src="data:image/png;base64,' + esc(pngB64) + '">' +
      '<p style="margin:12px 0 6px">Scan this with a phone camera, or send the link. Each person taps Turn on notifications.</p>' +
      '<input id="u" readonly value="' + u + '" style="width:100%;box-sizing:border-box;padding:8px;font:inherit;border:1px solid #DADCDF;border-radius:6px">' +
      '<p><button style="background:' + c + ';color:#fff;border:0;border-radius:6px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer" ' +
      'onclick="var i=document.getElementById(\'u\');i.select();navigator.clipboard.writeText(i.value).then(function(){this.textContent=\'Copied\'}.bind(this))">Copy link</button></p></div>';
  }
  function shareMissing() { return 'There is no sign-up page yet. Run Set up first.'; }

  function testMessage(appName) {
    var name = String(appName || '').trim() || TITLE;
    return { title: 'Test from ' + name, body: 'If you can read this, notifications work on this device.' };
  }

  // '1.2.3' -> [1, 2, 3], or null when it is not a version (a leading v and spaces are allowed).
  function parts(v) {
    var m = /^v?(\d+(\.\d+)*)$/.exec(String(v === undefined || v === null ? '' : v).trim());
    return m ? m[1].split('.').map(Number) : null;
  }

  // Is latest (what our GitHub page says) newer than current? Anything that is not a version is never news.
  function newer(current, latest) {
    var a = parts(current), b = parts(latest);
    if (!a || !b) return false;
    for (var i = 0; i < Math.max(a.length, b.length); i++) {
      var x = a[i] || 0, y = b[i] || 0;
      if (y !== x) return y > x;
    }
    return false;
  }

  function updateText(current, latest) {
    if (!parts(latest)) return "Couldn't check for an update just now. Try again later.";
    if (newer(current, latest)) return 'Version ' + String(latest).trim().replace(/^v/, '') + ' is out (you have ' + current + '). Get it from ' + SETUP.REPO + ' - nothing here was changed.';
    return "You're up to date (version " + current + ').';
  }

  // Which of the project's triggers (given by their function names) are ours to remove.
  function ours(handlerNames) {
    var out = [];
    handlerNames.forEach(function (f, i) { if (OWN_TRIGGERS.indexOf(f) >= 0) out.push(i); });
    return out;
  }

  function offText(removed) {
    if (!removed) return 'It was already off. ' + KEPT;
    return 'Turned off: ' + removed + (removed === 1 ? ' watcher' : ' watchers') + ' removed. ' + KEPT;
  }

  function testText(r) {
    if (!r.sent && !r.failed) return 'No devices are let in yet. Open the sign-up page on a phone or computer, tap Turn on, then tick it on the Devices tab.';
    if (!r.sent) return 'The test did not reach any device (' + r.failed + ' failed) - see Status on the Devices tab.';
    var text = 'Test sent to ' + r.sent + (r.sent === 1 ? ' device. It should' : ' devices. Each should') + ' show "Test from ..." now.';
    if (r.failed) text += ' ' + r.failed + ' failed - see its Status on the Devices tab.';
    return text;
  }

  // The shared master copy (Drive Galaxy did the same, 13 Oct): Set up refuses there, so it never holds anyone's
  // project, link or QR. People copy it and set up their own copy.
  var MASTERS = ['1cEkCkMDHR85XqrXljxhCz8w_LEZTNxWlts5GbpybLyA'];
  function isMaster(id) { return MASTERS.indexOf(String(id || '')) >= 0; }
  var MASTER_SAY = 'This is the shared master copy of Push from sheet, so Set up does not run here. Make your own copy (File › Make a copy), then run Set up in your copy.';

  return { MASTERS: MASTERS, isMaster: isMaster, MASTER_SAY: MASTER_SAY, TITLE: TITLE, VERSION: VERSION, OWN_TRIGGERS: OWN_TRIGGERS, items: items, testMessage: testMessage, newer: newer,
    updateText: updateText, ours: ours, offText: offText, testText: testText, shareHtml: shareHtml, shareMissing: shareMissing };
})(typeof SETUP !== 'undefined' ? SETUP : require(process.env.SETUP || './setup.js'));

if (typeof module !== 'undefined') module.exports = MENU;
// phonetab.js - keeps the owner's Phones tab and the script's stored phones in step (SPEC_V1, look B).
// The owner types Name, ticks or unticks Let in, and deletes rows. The script fills everything else.
// The tab is where names live (Push To matches them); the store is where keys and the let-in flag live.
// It never touches Apps Script: the caller hands in the stored records and the tab's rows, and applies what comes back.
// Runs in Apps Script and in Node (for the tests).

var PHONETAB = (function () {
  'use strict';

  var HEADER = ['Name', 'Email', 'Device', 'Let in', 'Signed up', 'Last seen', 'Last message', 'Status', 'ID'];
  var NAME = 0, EMAIL = 1, DEVICE = 2, LETIN = 3, ID = 8;
  var ON = 'On', WAITING = 'Waiting for your tick', STOPPED = 'Stopped - tick Let in to start it again';
  var GONE = 'Gone (its push service says so) - delete this row', NO_KEYS = 'Needs to open the page again';

  function text(v) { return (v === undefined || v === null) ? '' : String(v).trim(); }
  // A device's short name: the first 4 of its ID in capitals. The page shows the same ("This phone's name is 5BD4") and
  // hub.js asks this one for it, so the owner can match the phone in their hand to its row on Devices.
  function shortName(id) { return text(id).slice(0, 4).toUpperCase(); }
  function ticked(v) { return v === true || text(v).toUpperCase() === 'TRUE'; }

  // records = every stored phone (let in or waiting): { id, approved, stopped, listed, added, lastSeen, lastSend, email, device, keys }
  // rows = the tab's data rows (below the header), as getValues gives them. maxPhones = the most that may be let in.
  // fmt = turns a time in ms into text for the tab ('' when never).
  // Gives back { rows: the tab's new data rows, changes: [{ id, approved?, stopped?, listed?, remove? }] for the store,
  //              phones: [{ id, name, email }] the engine may send to, counts: { on, waiting, gone } }.
  function sync(records, rows, maxPhones, fmt) {
    var byId = {}, seen = {}, entries = [], others = [], changes = [];
    records.forEach(function (r) { byId[r.id] = r; });

    (rows || []).forEach(function (r) {
      var id = text(r[ID]);
      if (id === '') { if (r.some(function (c) { return text(c) !== ''; })) others.push(r); return; }
      if (seen[id]) return;
      seen[id] = true;
      entries.push({ id: id, rec: byId[id] || null, name: text(r[NAME]), tick: ticked(r[LETIN]), row: r });
    });
    records.forEach(function (r) {
      if (seen[r.id]) return;
      if (r.listed) { changes.push({ id: r.id, remove: true }); return; }
      entries.push({ id: r.id, rec: r, name: shortName(r.id), isNew: true });   // the name its page shows (cold test 2)
      changes.push({ id: r.id, listed: true });
    });

    // Phones already let in and still ticked keep their place; newly ticked ones get in while there is room.
    var kept = entries.filter(function (e) { return e.rec && !e.isNew && e.tick && e.rec.approved; }).length;
    var tabChanges = [];
    entries.forEach(function (e) {
      if (!e.rec) return;
      e.approved = e.rec.approved === true;
      e.stopped = e.rec.stopped === true;
      if (e.isNew) return;
      if (e.tick && !e.approved) {
        if (kept >= maxPhones) { e.full = true; return; }
        kept++;
        e.approved = true;
        var c = { id: e.id, approved: true };
        if (e.stopped) { c.stopped = false; e.stopped = false; }
        tabChanges.push(c);
      } else if (!e.tick && e.approved) {
        e.approved = false; e.stopped = true;
        tabChanges.push({ id: e.id, approved: false, stopped: true });
      }
    });
    changes = tabChanges.concat(changes);

    var out = [], phones = [], counts = { on: 0, waiting: 0, gone: 0 };
    entries.forEach(function (e) {
      if (!e.rec) {
        counts.gone++;
        out.push([e.name, text(e.row[EMAIL]), text(e.row[DEVICE]), false, e.row[4], e.row[5], e.row[6], GONE, e.id]);
        return;
      }
      var status;
      if (e.full) status = 'Full - untick another device first (most is ' + maxPhones + ')';
      else if (e.approved) status = e.rec.keys ? ON : NO_KEYS;
      else status = e.stopped ? STOPPED : WAITING;
      if (status === ON) { counts.on++; phones.push({ id: e.id, name: e.name, email: e.rec.email || '' }); }
      if (status === WAITING) counts.waiting++;
      out.push([e.name, e.rec.email || '', e.rec.device || '', e.approved, fmt(e.rec.added), fmt(e.rec.lastSeen), fmt(e.rec.lastSend), status, e.id]);
    });
    return { rows: out.concat(others), changes: changes, phones: phones, counts: counts };
  }

  // The tab's frame in look B (mock-up 'B Phones', the pick): row 2 the title, row 3 the counts, row 5 a line of help,
  // row 6 the header. Phone rows go from row 7, starting in column B (column A is the margin). 10 columns, A to J.
  // 18 Nov 12:59pm: notifications for everything, phones AND computers, so the tab is called Devices.
  var TAB_NAME = 'Devices';
  var HELP = 'Tick to let a device in, untick to stop it. Delete a row to remove it. ' +
    'Emails come from the sign-up link and don\'t prove who it is.';
  function frame(appName, counts) {
    var blank = function () { return ['', '', '', '', '', '', '', '', '', '']; };
    var rows = [blank(), blank(), blank(), blank(), blank(), [''].concat(HEADER)];
    rows[1][1] = appName + '  ·  ' + TAB_NAME;
    rows[2][1] = counts.on + ' on'; rows[2][3] = counts.waiting + ' waiting'; rows[2][5] = counts.gone + ' gone';
    rows[4][1] = HELP;
    return { rows: rows, headerRow: 6, firstDataRow: 7, firstCol: 2 };
  }

  // What each status starts with, for the drawing's colour rules (On green, Waiting amber, Gone struck through).
  var STATUS_START = { on: ON, waiting: WAITING.split(' ')[0], gone: GONE.split(' ')[0] };

  return { sync: sync, frame: frame, shortName: shortName, HEADER: HEADER, STATUS_START: STATUS_START, TAB_NAME: TAB_NAME };
})();

if (typeof module !== 'undefined') module.exports = PHONETAB;
// stage3-apps-script.js - Apps Script only. The web app that devices sign up with, and the sender.
// Version 1 (17 Nov 10:33pm): the words always travel locked inside the push - no fetch-back, no nudge.
// Devices are kept in Script Properties. Where the sheet, the key and the page are comes from PFS_ENV
// (env-share-apps-script.js for the sheet we share; the private test rig has its own).
var STAGE3_TTL = 86400;         // seconds the push service keeps a push for a phone that is off (ruling 17 Nov: 24 hours)
var STAGE3_URGENCY = 'high';    // asks the push service to wake a sleeping phone

function stage3Store_() {
  var p = PropertiesService.getScriptProperties();
  return {
    get: function (k) { return p.getProperty(k); },
    set: function (k, v) { p.setProperty(k, v); },
    remove: function (k) { p.deleteProperty(k); },
    keys: function () { return p.getKeys(); }
  };
}
function stage3Key_() {
  var key = PropertiesService.getScriptProperties().getProperty(PFS_ENV.keyProp);
  if (!key) throw new Error('No sending key yet - run Set up');
  return key;
}
// Times are shown in the SHEET's own time zone (File > Settings), not the script's: a copy made in another country
// keeps the script's zone from the original (the cold test, 18 Nov). One definition, used everywhere a time is written.
function pfsZone_() {
  try { return PFS_ENV.book().getSpreadsheetTimeZone() || Session.getScriptTimeZone(); } catch (e) { return Session.getScriptTimeZone(); }
}
function stage3Clock_(ms) {
  return ms ? Utilities.formatDate(new Date(ms), pfsZone_(), 'h:mm:ss a') : 'never';
}

// The web app. Phones call it with ?action=key / subscribe / unsubscribe.
function doGet(e) {
  var answer, lock = LockService.getScriptLock();
  try {
    lock.waitLock(8000);
    var config = { publicKey: ES256.b64url(ES256.publicKey(stage3Key_())), maxPhones: 20, signup: PFS_ENV.signup() };
    answer = PUSHHUB.handle(e && e.parameter, stage3Store_(), Date.now(), config);
  } catch (err) {
    answer = { ok: false, error: 'script error' };
  } finally {
    lock.releaseLock();
  }
  // A device that just signed up or left shows on the Devices tab straight away (the cold test, 18 Nov: the new phone
  // was not there until something else ran). Never allowed to spoil the answer to the device.
  var did = e && e.parameter && e.parameter.action;
  if (answer && answer.ok && (did === 'subscribe' || did === 'unsubscribe')) {
    try { runSyncPhones_(PFS_ENV.book()); } catch (err2) { Logger.log('Devices tab not refreshed: ' + err2); }
  }
  return ContentService.createTextOutput(JSON.stringify(answer)).setMimeType(ContentService.MimeType.JSON);
}

// Sends the words, locked inside the push, to every let-in phone that gave its keys. Gives back one entry per phone.
function stage3SendAll_(title, body) {
  return stage3PushTo_(PUSHHUB.phones(stage3Store_()), { title: title, body: body, at: Date.now() });
}

// 64 random bytes from Apps Script's own random IDs, mixed through SHA-256 (for each locked message's salt and one-off key).
function stage3Random64_() {
  var seed = '', i, out = [];
  for (i = 0; i < 6; i++) seed += Utilities.getUuid();
  for (i = 1; i <= 2; i++) {
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed + '|' + i).forEach(function (v) { out.push(v < 0 ? v + 256 : v); });
  }
  return out;
}

// Sends one push to each of the given phones, the words locked inside with that phone's two keys, and notes the answers.
function stage3PushTo_(list, msg) {
  var store = stage3Store_(), key = stage3Key_(), lock = LockService.getScriptLock();
  var words = ES256.utf8(PUSH.message(msg.title, msg.body, msg.at, msg.navigate || PFS_ENV.page()));
  var sent = list.map(function (ph) {
    var f = LOCK.fresh(stage3Random64_());
    var body = LOCK.seal(words, ph.p256dh, ph.auth, f.ephPrivHex, f.salt);
    var r = PUSH.buildRequest(ph.endpoint, key, 'mailto:test@example.com', Math.floor(Date.now() / 1000), STAGE3_TTL, STAGE3_URGENCY, body);
    var code = UrlFetchApp.fetch(r.url, { method: r.method, headers: r.headers, muteHttpExceptions: true, payload: r.payload, contentType: r.headers['Content-Type'] }).getResponseCode();
    return { id: ph.id, via: PUSH.audienceOf(ph.endpoint), code: code, result: '' };
  });
  lock.waitLock(20000);
  try { sent.forEach(function (s) { s.result = PUSHHUB.recordSend(store, s.id, s.code, Date.now(), { title: msg.title, body: msg.body, at: msg.at }); }); } finally { lock.releaseLock(); }
  return sent;
}
function stage3Lines_(sent) {
  return sent.map(function (s) { return 'PHONE ' + s.id.slice(0, 4).toUpperCase() + ' via ' + s.via + ' answered ' + s.code + ' = ' + s.result + ' (words inside)'; });
}

// run-apps-script.js - Apps Script only. The version 1 engine against the owner's sheet: reads the Setup tab
// (look B labels), watches the tab named there, and for each new row plans (ENGINE), locks the words for each
// device (LOCK) and sends (PUSH), then writes the Notified note. Which sheet, which Setup tab and which devices
// come from PFS_ENV (the test rig and the shared sheet each have their own small env file).
// One stored record per run that has marked rows Sending... and not finished: its name starts with this, its value is when it started.
var RUN_PENDING = 'run-sending-';

function runSettings_(book) {
  var tab = book.getSheetByName(PFS_ENV.setupTab);
  if (!tab) throw new Error('No tab called ' + PFS_ENV.setupTab);
  var r = SETUP.read(tab.getDataRange().getDisplayValues());
  if (r.problems.length) throw new Error('Setup problems: ' + r.problems.join(' | '));
  return r.settings;
}

// The owner's tab, its header and rows. Adds the Notified column at the end if it is missing.
function runRead_() {
  var book = PFS_ENV.book(), s = runSettings_(book);
  s.tab = runFollowTab_(book, s.tab);
  var sheet = book.getSheetByName(s.tab);
  if (!sheet) throw new Error('No tab called ' + s.tab);
  var all = sheet.getDataRange().getDisplayValues(), header = all[0];
  if (header.map(function (h) { return h.trim(); }).indexOf(s.notified) < 0) {
    sheet.getRange(1, header.length + 1).setValue(s.notified);
    SpreadsheetApp.flush();
    all = sheet.getDataRange().getDisplayValues(); header = all[0];
  }
  return { sheet: sheet, settings: s, header: header, rows: all.slice(1) };
}

// The owner's tab is remembered by Google's own ID for it (18 Nov). If it was renamed, the Setup cell is
// changed to the new name, so nothing breaks. The "Tab with your rows" dropdown is refreshed with the tabs as they are now.
// Gives the tab name to use.
function runFollowTab_(book, wanted) {
  var props = PropertiesService.getScriptProperties(), stored = props.getProperty('PFS_TAB_ID');
  var tabs = book.getSheets().map(function (sh) { return { name: sh.getName(), id: sh.getSheetId() }; });
  var r = SETUPTAB.followTab(wanted, stored === null ? null : Number(stored), tabs);
  if (r.id !== null) props.setProperty('PFS_TAB_ID', String(r.id));
  var setup = book.getSheetByName(PFS_ENV.setupTab);
  if (setup) {
    var labels = setup.getRange(1, 2, setup.getLastRow() || 1, 1).getDisplayValues();
    for (var i = 0; i < labels.length; i++) {
      if (String(labels[i][0]).trim() !== 'Tab with your rows') continue;
      var cell = setup.getRange(i + 1, 3), list = SETUPTAB.ownerTabs(tabs.map(function (t) { return t.name; }));
      if (list.length) cell.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build());
      if (r.renamed) { cell.setValue(r.name); Logger.log('Your tab was renamed - Setup now says ' + r.name + '.'); }
      break;
    }
  }
  return r.name;
}

function runNote_(t, rowIndexes, text) {
  var col = t.header.map(function (h) { return h.trim(); }).indexOf(t.settings.notified) + 1;
  rowIndexes.forEach(function (i) { t.sheet.getRange(i + 2, col).setValue(text); });
  SpreadsheetApp.flush();
}

// Brings the Devices tab (look B, the pick; called Devices since 18 Nov 12:59pm) and the stored phones into step
// (PHONETAB.sync): the owner's ticks, names and deleted rows go into the store, and the tab gets the latest details.
// The first time, the rows of the old 'Phones' tab (header in row 1) are moved across; the old tab is left alone.
// The whole tab is drawn only when it is new, its header is not where look B puts it, or the rows have outgrown it;
// otherwise only the rows and the counts are written, so an ordinary send stays quick.
// Gives back the devices the engine may send to (PFS_ENV.keep: the test rig sends to its own two only).
// held = the caller already holds the script lock and keeps it (run_): this must not take or release it. Found 18 Nov
// in the rehearsal: releasing here let run_ carry on unlocked while it marked rows Sending, so two runs starting in the
// same second could both have sent a row. (How I know: Google's notes say releaseLock lets waiting runs go; not seen live.)
function runSyncPhones_(book, settings, held) {
  var s = settings || runSettings_(book), width = PHONETAB.HEADER.length;
  var blank = PHONETAB.frame('', { on: 0, waiting: 0, gone: 0 }), first = blank.firstDataRow, col = blank.firstCol;
  var tab = book.getSheetByName(PHONETAB.TAB_NAME), rows = [], moved = 0, last;
  if (tab) {
    last = tab.getLastRow();
    rows = last >= first ? tab.getRange(first, col, last - first + 1, width).getValues() : [];
  } else {
    var old = PFS_ENV.oldPhonesTab ? book.getSheetByName(PFS_ENV.oldPhonesTab) : null;
    if (old && old.getLastRow() > 1) { rows = old.getRange(2, 1, old.getLastRow() - 1, width).getValues(); moved = rows.length; }
    tab = book.insertSheet(PHONETAB.TAB_NAME);
  }
  var store = stage3Store_(), lock = LockService.getScriptLock(), r;
  if (!held) lock.waitLock(20000);
  try {
    r = PHONETAB.sync(PUSHHUB.records(store), rows, 20, function (ms) {
      return ms ? Utilities.formatDate(new Date(ms), pfsZone_(), 'd MMM h:mm a').replace('AM', 'am').replace('PM', 'pm') : '';
    });
    r.changes.forEach(function (c) { PUSHHUB.update(store, c); });
  } finally {
    if (!held) lock.releaseLock();
  }
  var frame = PHONETAB.frame(s.appName, r.counts);
  var header = tab.getRange(frame.headerRow, col, 1, width - 1).getDisplayValues()[0].join('|');
  // A full redraw when the tab is not ours yet, is too short, or the owner changed the colour (cold test: Devices stayed blue).
  var tint = String(tab.getTabColor() || '').toUpperCase();
  if (header !== PHONETAB.HEADER.slice(0, width - 1).join('|') || tab.getMaxRows() < first + r.rows.length + 1 || tint !== String(s.colour).toUpperCase()) phonesDraw_(tab, frame, r.rows, s.colour);
  else phonesFill_(tab, frame, r.rows);
  if (moved) Logger.log('MOVED ' + moved + ' row(s) from the old ' + PFS_ENV.oldPhonesTab + ' tab to ' + PHONETAB.TAB_NAME + '. The old tab is left as it was.');
  return PFS_ENV.keep(r.phones);
}

// The stored record (endpoint and keys) for each phone the engine picked.
function runPhoneRecords_() {
  var byId = {};
  PUSHHUB.phones(stage3Store_()).forEach(function (ph) { byId[ph.id] = ph; });
  return byId;
}

// The start times of runs that marked rows and have not finished (a dead run's record stays behind).
function runPending_() {
  var p = PropertiesService.getScriptProperties(), out = {};
  p.getKeys().forEach(function (k) { if (k.indexOf(RUN_PENDING) === 0) out[k] = p.getProperty(k); });
  return out;
}

// Runs by itself whenever the sheet changes (and can be run by hand from the editor).
function runOnChange() { run_(false); }

// ruling 18 Nov (cold test: a row typed by hand went out with only its title): with Setup's "Wait before sending"
// on, a new row is marked Sending soon... and sent once it has sat unchanged for that long. Each change to the sheet
// starts its own run; only the NEWEST run keeps waiting (the others stop within 5 seconds), so typing a row costs about
// its typing time plus the wait, once. Called holding the lock; gives back { t, rows } holding the lock again
// (rows = the settled rows, or null when there is no wait), or null when this run should stop.
var RUN_WAIT = 'pfs-wait';
function runWait_(t, lock, props) {
  var wait = t.settings.waitSeconds, before, now, rows = [], me, s, round;
  if (!wait) return { t: t, rows: null };
  before = ENGINE.pending(t.header, t.rows, t.settings);
  if (!Object.keys(before).length) return { t: t, rows: [] };
  me = Utilities.getUuid(); props.setProperty(RUN_WAIT, me);
  for (round = 0; round < 3; round++) {
    runNote_(t, Object.keys(before).map(Number), ENGINE.SOON);
    lock.releaseLock();
    for (s = 0; s < wait; s += 5) {
      Utilities.sleep(Math.min(5, wait - s) * 1000);
      if (props.getProperty(RUN_WAIT) !== me) { Logger.log('A newer change is doing the waiting - this run stops.'); return null; }
    }
    if (!lock.tryLock(20000)) return null;
    t = runRead_();
    now = ENGINE.pending(t.header, t.rows, t.settings);
    rows = ENGINE.settled(before, now);
    if (rows.length === Object.keys(now).length) break;   // everything waiting has settled
    before = now;                                           // something is still being typed: wait again (3 rounds at most)
  }
  return { t: t, rows: rows };
}

// The backup check (go-ahead, 18 Nov). Runs by itself as often as the Setup tab says (10 minutes unless changed). It sends rows that a change run missed
// (Google now and then fails a run before it starts), and gives a row stuck on Sending... ONE second try once every
// run that marked rows is at least 10 minutes old. A row whose second try also died is marked as failed twice.
// When there is nothing to do it stops after one read of the sheet, to save the daily allowance.
function runTimer() { run_(true); }

// The Sending... note is written BEFORE anything is sent, so a failed run never sends the same row again and again.
function run_(fromTimer) {
  var lock = LockService.getScriptLock(), props = PropertiesService.getScriptProperties();
  var t, phones, plans, b, pending, retry = false, dead, mine = '', w;
  var rowOf = function (p) { return p.row; };
  if (!lock.tryLock(20000)) return;
  try {
    t = runRead_();
    if (fromTimer) {
      pending = runPending_();
      retry = ENGINE.quiet(Object.keys(pending).map(function (k) { return pending[k]; }), Date.now());
      if (retry) {
        Object.keys(pending).forEach(function (k) { props.deleteProperty(k); });
        dead = ENGINE.failedTwice(t.header, t.rows, t.settings);
        if (dead.length) { runNote_(t, dead, ENGINE.GAVE_UP); Logger.log('FAILED TWICE: ' + dead.length + ' row(s) marked ' + ENGINE.GAVE_UP); }
      }
      if (!ENGINE.plan(t.header, t.rows, t.settings, [], PFS_ENV.page(), retry).length) { Logger.log('Backup check: nothing waiting.'); return; }
    }
    w = runWait_(t, lock, props);
    if (!w) return;
    t = w.t;
    phones = runSyncPhones_(PFS_ENV.book(), t.settings, true);
    plans = ENGINE.ready(ENGINE.plan(t.header, t.rows, t.settings, phones, PFS_ENV.page(), retry), w.rows);
    if (!plans.length) { Logger.log(w.rows && Object.keys(ENGINE.pending(t.header, t.rows, t.settings)).length ? 'A row is still being typed - it goes when it has sat unchanged.' : 'Nothing new.'); return; }
    b = ENGINE.batch(plans);
    if (b.send.length) { mine = RUN_PENDING + Utilities.getUuid(); props.setProperty(mine, String(Date.now())); }
    if (b.skip.length) runNote_(t, b.skip, ENGINE.TOO_MANY);
    runNote_(t, b.send.filter(function (p) { return !p.retry; }).map(rowOf), ENGINE.SENDING);
    runNote_(t, b.send.filter(function (p) { return !!p.retry; }).map(rowOf), ENGINE.AGAIN);
  } finally {
    lock.releaseLock();
  }
  var byId = runPhoneRecords_();
  b.send.forEach(function (p) {
    var list = p.phoneIds.map(function (id) { return byId[id]; }).filter(function (ph) { return !!ph; });
    var sent = list.length ? stage3PushTo_(list, { title: p.title, body: p.body, at: Date.now(), navigate: p.navigate }) : [];
    var ok = sent.filter(function (s) { return s.code >= 200 && s.code < 300; }).length;
    var note = ENGINE.note({ sent: ok, failed: sent.length - ok, unknown: p.unknown, retry: !!p.retry, linkSkipped: p.linkSkipped }, stage3Clock_(Date.now()));
    runNote_(t, [p.row], note);
    Logger.log((fromTimer ? 'BACKUP CHECK ' : '') + 'ROW ' + (p.row + 2) + ': ' + p.title + ' / ' + p.body + ' -> ' + note + String.fromCharCode(10) + stage3Lines_(sent).join(String.fromCharCode(10)));
  });
  if (mine) props.deleteProperty(mine);
  if (b.skip.length) Logger.log('TOO MANY: ' + b.skip.length + ' rows marked ' + ENGINE.TOO_MANY);
}

// Run once. Rows already in the tab are marked so they are never sent, then the sheet is watched
// and the backup check is started, as often as the Setup tab's 'Backup check' says (Off, 5, 10, 15 or 30 minutes; blank = 10). Also removes the old join-test watcher so only one thing watches the sheet.
function runTurnOn() {
  var t = runRead_();
  var old = ENGINE.plan(t.header, t.rows, t.settings, [], PFS_ENV.page()).map(function (p) { return p.row; });
  runNote_(t, old, ENGINE.OLD);
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    var f = tr.getHandlerFunction();
    if (f === 'runOnChange' || f === 'runTimer' || f === 'joinOnChange') ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('runOnChange').forSpreadsheet(PFS_ENV.book()).onChange().create();
  if (t.settings.backupMinutes) ScriptApp.newTrigger('runTimer').timeBased().everyMinutes(t.settings.backupMinutes).create();
  Logger.log('ON, ' + (t.settings.backupMinutes ? 'with a backup check every ' + t.settings.backupMinutes + ' minutes' : 'with NO backup check (Backup check is Off in Setup)') + '. Watching tab ' + t.settings.tab + ' (title: ' + t.settings.title + ', message: ' + t.settings.message.join(', ') + ', Push To: ' + (t.settings.pushTo || '-') +
    '). Old rows marked: ' + old.length + '. Phones it may send to: ' + runSyncPhones_(PFS_ENV.book()).map(function (p) { return p.id.slice(0, 4).toUpperCase() + (p.name ? ' (' + p.name + ')' : ''); }).join(', '));
}

function runTurnOff() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    var f = tr.getHandlerFunction();
    if (f === 'runOnChange' || f === 'runTimer') { ScriptApp.deleteTrigger(tr); n++; }
  });
  Logger.log('OFF. Watcher and backup check removed: ' + n);
}

// Checks the settings and shows what would happen, without sending or writing anything.
function runCheck() {
  var t = runRead_(), phones = runSyncPhones_(PFS_ENV.book());
  var plans = ENGINE.plan(t.header, t.rows, t.settings, phones, PFS_ENV.page());
  Logger.log('SETTINGS OK: ' + JSON.stringify(t.settings) + String.fromCharCode(10) + 'Phones: ' + phones.map(function (p) { return p.id.slice(0, 4).toUpperCase() + ' ' + (p.name || '(no name)') + ' ' + p.email; }).join(', ') + '. New rows waiting: ' + plans.length +
    String.fromCharCode(10) + plans.map(function (p) { return 'row ' + (p.row + 2) + ': ' + p.title + ' / ' + p.body + ' -> ' + p.phoneIds.length + ' phone(s)' + (p.unknown.length ? ', no phone for ' + p.unknown.join(', ') : ''); }).join(String.fromCharCode(10)));
}
// draw-setup-apps-script.js - Apps Script only. Draws the Setup tab that SETUPTAB.build decided, in look B
// (the pick 17 Nov 2026). Colours, fonts, row heights and borders were read off the mock-up tab 'B Setup'
// (sheet 1B4ol5o3Um4Vn884O_oMYPZl7wokfbv2puM9o-cgiXcM) on 18 Nov, so it copies his pick, not a look of Claude's.
// The band and the section titles take the owner's colour.
var LOOKB = { page: '#EDF0F4', ink: '#1F2023', grey: '#5F6268', card: '#FFFFFF', line: '#DADCDF', faint: '#F0F3F4',
  field: '#F8F8F9', sub: '#DCE6F5', font: 'Roboto' };
var LOOKB_HEIGHT = { band: 14, title: 42, subtitle: 21, statushead: 26, status: 32, gap: 21, section: 34, setting: 30, step: 30, phonepage: 40, note: 24 };

// sheet = the tab to draw on (its old drawing is cleared first; values come from built.rows, which kept the owner's).
function setupDraw_(sheet, built, colour) {
  var t0 = Date.now(), part = function (what) { Logger.log('Drawing - ' + what + ': ' + Math.round((Date.now() - t0) / 100) / 10 + ' s'); };   // where the drawing time goes (18 Nov)
  var n = built.rows.length, W = 5, kinds = built.kinds, keep = built.share ? built.share.col : W + 1;   // the share panel needs F (gap) and G
  var old = sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), n), Math.max(sheet.getMaxColumns(), W));
  old.breakApart(); old.clearDataValidations(); old.clearFormat(); old.clearContent();
  if (sheet.getMaxRows() > n + 5) sheet.deleteRows(n + 6, sheet.getMaxRows() - n - 5);
  if (sheet.getMaxColumns() < keep) sheet.insertColumnsAfter(sheet.getMaxColumns(), keep - sheet.getMaxColumns());
  if (sheet.getMaxColumns() > keep) sheet.deleteColumns(keep + 1, sheet.getMaxColumns() - keep);
  sheet.setHiddenGridlines(true);
  sheet.setColumnWidth(1, 28);
  sheet.setColumnWidths(2, 4, 200);
  if (built.share) { sheet.setColumnWidth(6, 21); sheet.setColumnWidth(built.share.col, built.share.width); }
  sheet.setTabColor(colour);

  var whole = sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns());
  whole.setBackground(LOOKB.page).setFontFamily(LOOKB.font).setFontSize(10).setFontColor(LOOKB.ink).setVerticalAlignment('middle');
  sheet.getRange(1, 1, n, W).setValues(built.rows);
  part('cleared and filled');

  var groups = {};   // style name -> list of A1 ranges, so each style is set in one go
  var put = function (style, a1) { (groups[style] = groups[style] || []).push(a1); };
  var r = function (row, from, to) { return from + row + (to ? ':' + to + row : ''); };
  kinds.forEach(function (kind, i) {
    var row = i + 1;
    if (kind === 'band' || kind === 'title' || kind === 'subtitle') { put('band', r(row, 'A', 'E')); if (kind !== 'band') put(kind, r(row, 'B', 'E')); return; }
    if (kind === 'gap') return;
    put('card', r(row, 'B', 'E'));
    put('sides', r(row, 'B', 'E'));
    if (i + 1 >= kinds.length || kinds[i + 1] === 'gap') put('blockEnd', r(row, 'B', 'E'));
    if (kind === 'statushead') put('statushead', r(row, 'B', 'E'));
    else if (kind === 'status') put('notyet', r(row, 'B', 'E'));
    else if (kind === 'section') { put('section', r(row, 'B', 'E')); put('blockStart', r(row, 'B', 'E')); put('merge', r(row, 'B', 'E')); }
    else if (kind === 'setting' || kind === 'step') {
      put('label', r(row, 'B')); put('rowline', r(row, 'B', 'E')); put('help', r(row, 'D', 'E')); put('merge', r(row, 'D', 'E'));
      put(kind === 'setting' ? 'field' : 'notyet', r(row, 'C'));
    }
    else if (kind === 'phonepage') {   // the QR picture lives in the share panel now (18 Nov)
      put('phonelabel', r(row, 'B')); put('phonevalue', r(row, 'C', 'E')); put('merge', r(row, 'C', 'E'));
    }
    else if (kind === 'note') { put('help', r(row, 'B', 'E')); put('rowline', r(row, 'B', 'E')); put('merge', r(row, 'B', 'E')); }
  });
  // Row heights in runs: one call per run of equal heights instead of one per row (speed, 18 Nov: drawing was ~19 s).
  for (var start = 0; start < kinds.length;) {
    var h = LOOKB_HEIGHT[kinds[start]] || 21, end = start;
    while (end + 1 < kinds.length && (LOOKB_HEIGHT[kinds[end + 1]] || 21) === h) end++;
    if (end === start) sheet.setRowHeight(start + 1, h); else sheet.setRowHeights(start + 1, end - start + 1, h);
    start = end + 1;
  }
  var each = function (style, fn) { if (groups[style]) fn(sheet.getRangeList(groups[style])); };
  var SOLID = SpreadsheetApp.BorderStyle.SOLID;
  each('band', function (l) { l.setBackground(colour).setFontColor('#FFFFFF'); });
  each('title', function (l) { l.setFontSize(22).setFontWeight('bold'); });
  each('subtitle', function (l) { l.setFontColor(LOOKB.sub); });
  each('card', function (l) { l.setBackground(LOOKB.card); });
  each('statushead', function (l) { l.setFontSize(8).setFontWeight('bold').setFontColor(LOOKB.grey); });
  each('notyet', function (l) { l.setBackground(LOOKB.faint).setFontWeight('bold').setFontColor(LOOKB.grey); });
  each('section', function (l) { l.setFontSize(12).setFontWeight('bold').setFontColor(colour); });
  each('label', function (l) { l.setFontColor(LOOKB.grey); });
  each('help', function (l) { l.setFontSize(9).setFontColor(LOOKB.grey).setWrap(true); });
  each('phonelabel', function (l) { l.setFontWeight('bold').setFontColor(colour); });
  each('phonevalue', function (l) { l.setFontStyle('italic').setFontColor(LOOKB.grey); });
  each('rowline', function (l) { l.setBorder(null, null, true, null, null, null, LOOKB.faint, SOLID); });
  each('field', function (l) { l.setBackground(LOOKB.field).setBorder(null, null, true, null, null, null, colour, SOLID); });
  each('sides', function (l) { l.setBorder(null, true, null, true, null, null, LOOKB.line, SOLID); });
  each('blockStart', function (l) { l.setBorder(true, null, null, null, null, null, LOOKB.line, SOLID); });
  each('blockEnd', function (l) { l.setBorder(null, null, true, null, null, null, LOOKB.line, SOLID); });
  (groups.merge || []).forEach(function (a1) { sheet.getRange(a1).merge(); });
  part('styled and merged');

  // The ticks: green done, amber needs you, red failed, grey not yet (look B mock-up colours). The reason beside a
  // failed step (column D) only takes the colour of its words.
  var TONE = { green: ['#E6F4EA', '#137333'], amber: ['#FDF7DF', '#895A00'], red: ['#FBE8E6', '#C5211F'], grey: [LOOKB.faint, LOOKB.grey],
    live: ['#E6F4EA', '#137333'] };   // the LIVE pill in the heading (18 Nov)
  var byTone = {};
  // The empty Firebase project box stands out with a thick border in the owner's colour (cold test 2): it is the one
  // box a new owner must fill, and it must not look like the yellow status boxes.
  var need = (built.tones || []).filter(function (t) { return t.tone === 'need'; }).map(function (t) { return sheet.getRange(t.row, t.col).getA1Notation(); });
  if (need.length) sheet.getRangeList(need).setBackground(LOOKB.card).setBorder(true, true, true, true, null, null, colour, SpreadsheetApp.BorderStyle.SOLID_THICK);
  (built.tones || []).filter(function (t) { return t.tone !== 'need'; }).forEach(function (t) {
    var key = t.tone + (t.col === 4 ? ':words' : ':cell');
    (byTone[key] = byTone[key] || []).push(sheet.getRange(t.row, t.col).getA1Notation());
  });
  Object.keys(byTone).forEach(function (key) {
    var tone = TONE[key.split(':')[0]], list = sheet.getRangeList(byTone[key]);
    if (key.split(':')[1] === 'words') list.setFontColor(tone[1]);
    else list.setBackground(tone[0]).setFontColor(tone[1]).setFontWeight('bold');
  });

  // Column dropdowns read the owner's heading row itself (18 Nov), so a renamed heading shows at once and a stale
  // pick gets Sheets' own red mark. Others are plain lists.
  // The owner's tab and its width are looked up once (each look is a read that stalls the drawing, 18 Nov).
  var book = null, heads = {};
  var headerRow = function (name) {
    if (name in heads) return heads[name];
    if (!book) book = sheet.getParent();
    var tab = book.getSheetByName(name), last = tab ? tab.getLastColumn() : 0;
    return (heads[name] = last ? tab.getRange(1, 1, 1, last) : null);
  };
  built.dropdowns.forEach(function (d) {
    var rule = SpreadsheetApp.newDataValidation(), from = d.fromHeader ? headerRow(d.fromHeader) : null;
    if (from) rule = rule.requireValueInRange(from, true);
    else rule = rule.requireValueInList(d.list, true);
    sheet.getRange(d.row, 3).setDataValidation(rule.setAllowInvalid(!d.strict).build());
  });
  // The heading band and section titles follow the Colour dropdown as soon as a name is picked (18 Nov).
  // A typed code shows on the next Set up (that is the plain colour above).
  if (built.colourRow) {
    var rules = [], bandA1 = groups.band || [], titleA1 = (groups.section || []).concat(groups.phonelabel || []);
    // The LIVE pill sits on the band: its own rule goes first (the first rule that matches a cell wins), so a picked
    // colour never paints over it and it stays light green and readable (18 Nov, Green made it vanish).
    (built.tones || []).filter(function (t) { return t.tone === 'live'; }).forEach(function (t) {
      var cell = sheet.getRange(t.row, t.col), at = '$' + String.fromCharCode(64 + t.col) + '$' + t.row;   // e.g. $E$2
      rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=LEN(' + at + ')>0')
        .setBackground(TONE.live[0]).setFontColor(TONE.live[1]).setRanges([cell]).build());
    });
    Object.keys(SETUP.COLOURS).forEach(function (name) {
      var when = '=LOWER(TRIM($C$' + built.colourRow + '))="' + name.toLowerCase() + '"', hex = SETUP.COLOURS[name];
      if (bandA1.length) rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(when).setBackground(hex)
        .setRanges(bandA1.map(function (a) { return sheet.getRange(a); })).build());
      if (titleA1.length) rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(when).setFontColor(hex)
        .setRanges(titleA1.map(function (a) { return sheet.getRange(a); })).build());
    });
    sheet.setConditionalFormatRules(rules);
  }
  part('ticks, dropdowns, colour rules');
  // Only the words up to the › are the link (bold, owner's colour); anything after stays plain grey help text.
  built.links.forEach(function (k) {
    // A link with its own start and end (an address inside a failed step's reason) covers just that part.
    var from = k.end ? k.start : 0, end = k.end || k.text.indexOf('›') + 1 || k.text.length;
    var bold = SpreadsheetApp.newTextStyle().setBold(true).setForegroundColor(colour).build();
    sheet.getRange(k.row, k.col).setRichTextValue(SpreadsheetApp.newRichTextValue().setText(k.text)
      .setLinkUrl(from, end, k.url).setTextStyle(from, end, bold).build());
  });
  // The share panel to the right of the card (18 Nov): a white box in column G, the QR placed over it by pfsPlaceQr_.
  if (built.share) {
    var sh = built.share, G = sh.col;
    sheet.getRange(sh.top, G, sh.bottom - sh.top + 1, 1).setBackground(LOOKB.card).setBorder(true, true, true, true, null, null, LOOKB.line, SOLID)
      .setHorizontalAlignment('center').setWrap(true);
    sh.cells.forEach(function (c) {
      var cell = sheet.getRange(c.row, G);
      if (c.kind === 'sharelink') {
        var linkStyle = SpreadsheetApp.newTextStyle().setBold(true).setForegroundColor(colour).build();
        cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(c.text).setLinkUrl(c.url).setTextStyle(linkStyle).build());
      } else {
        cell.setValue(c.text);
        if (c.kind === 'sharetitle') cell.setFontSize(12).setFontWeight('bold').setFontColor(colour);
        else cell.setFontSize(9).setFontColor(LOOKB.grey);
      }
    });
  }
  part('links and share panel');
  SpreadsheetApp.flush(); part('Google has drawn it');
  // The boxes Set up fills in warn before anyone types over them (cold test 2: a project name typed into the status box).
  // Warning only: the owner can still go ahead, and the script itself is never stopped.
  sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) { if (p.getDescription() === SETUP_LOCK_NOTE) p.remove(); });
  (built.locked || []).forEach(function (l) {
    sheet.getRange(l.row, l.col, l.rows, l.cols).protect().setDescription(SETUP_LOCK_NOTE).setWarningOnly(true);
  });
  SpreadsheetApp.flush(); part('locks');
}
var SETUP_LOCK_NOTE = 'Push from sheet fills this in - type in the white boxes';

// ---- The Phones tab in look B (mock-up 'B Phones', read 18 Nov): band with the title, count pills, a line of help,
// a header on row 6 underlined in the owner's colour, phone rows from row 7. The colour rules are the mock-up's own:
// On = green, Waiting = amber (row tinted), Gone = struck through in grey. The ID column (J) is hidden.
var PHONES_WIDTHS = [28, 130, 190, 160, 64, 120, 120, 120, 230, 28];

// frame = PHONETAB.frame(...); rows = the phone rows PHONETAB.sync gave (9 cells each, Name ... ID).
function phonesDraw_(sheet, frame, rows, colour) {
  var W = 10, first = frame.firstDataRow, n = rows.length, last = Math.max(first + n + 5, first + 20);
  var all = sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), last), Math.max(sheet.getMaxColumns(), W));
  all.breakApart(); all.clearDataValidations(); all.clearFormat(); all.clearContent();
  sheet.clearConditionalFormatRules();
  if (sheet.getMaxRows() > last) sheet.deleteRows(last + 1, sheet.getMaxRows() - last);
  if (sheet.getMaxRows() < last) sheet.insertRowsAfter(sheet.getMaxRows(), last - sheet.getMaxRows());
  if (sheet.getMaxColumns() > W) sheet.deleteColumns(W + 1, sheet.getMaxColumns() - W);
  sheet.setHiddenGridlines(true);
  sheet.setTabColor(colour);
  PHONES_WIDTHS.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  sheet.getRange(1, 1, last, W).setBackground(LOOKB.page).setFontFamily(LOOKB.font).setFontSize(10).setFontColor(LOOKB.ink).setVerticalAlignment('middle');
  // Dates are written as text, so the sheet shows them as written ('17 Nov 7:37 pm'), not as 24-hour sheet dates.
  sheet.getRange(first, 6, last - first + 1, 3).setNumberFormat('@');
  // Name, Email, Device and ID are text too: a short name like 78E6 was read as a number and showed 7.80E+07 (19 Nov).
  sheet.getRange(first, 2, last - first + 1, 3).setNumberFormat('@');
  sheet.getRange(first, 10, last - first + 1, 1).setNumberFormat('@');

  sheet.getRange(1, 1, frame.rows.length, W).setValues(frame.rows);
  if (n) sheet.getRange(first, frame.firstCol, n, 9).setValues(rows);

  [14, 48, 36, 21, 21, 32].forEach(function (h, i) { sheet.setRowHeight(i + 1, h); });
  sheet.setRowHeights(first, last - first + 1, 34);   // one call for all the device rows (speed, 18 Nov)
  sheet.getRange(1, 1, 2, W).setBackground(colour).setFontColor('#FFFFFF');
  sheet.getRange(2, 2).setFontSize(20).setFontWeight('bold');
  var pill = function (a1, bg, ink) { sheet.getRange(a1).setBackground(bg).setFontColor(ink).setFontSize(11).setFontWeight('bold').setHorizontalAlignment('center'); };
  pill('B3', '#E6F4EA', '#137333'); pill('D3', '#FDF7DF', '#895A00'); pill('F3', LOOKB.faint, LOOKB.grey);
  sheet.getRange(5, 2).setFontSize(9).setFontColor(LOOKB.grey);
  var SOLID = SpreadsheetApp.BorderStyle.SOLID, h = frame.headerRow;
  sheet.getRange(h, 2, 1, 8).setBackground(LOOKB.card).setFontSize(9).setFontWeight('bold').setFontColor(LOOKB.grey)
    .setBorder(true, true, null, true, null, null, LOOKB.line, SOLID).setBorder(null, null, true, null, null, null, colour, SOLID);
  sheet.getRange(h, 5).setHorizontalAlignment('center');
  sheet.setFrozenRows(h);

  // The table is drawn down to the last row, so phones that join later land in it (phonesFill_ only writes values).
  var size = last - first + 1;
  sheet.getRange(first, 2, size, 8).setBackground(LOOKB.card).setBorder(null, true, true, true, null, true, '#EBECEE', SOLID)
    .setBorder(null, true, true, true, null, null, LOOKB.line, SOLID);
  sheet.getRange(first, 3, size, 1).setFontSize(9).setFontColor(LOOKB.grey);
  sheet.getRange(first, 5, size, 1).setHorizontalAlignment('center');
  if (n) sheet.getRange(first, 5, n, 1).insertCheckboxes();
  var area = sheet.getRange(first, 2, last - first + 1, 8), status = sheet.getRange(first, 9, last - first + 1, 1);
  var tint = sheet.getRange(first, 2, last - first + 1, 7), I = '$I' + first, S = PHONETAB.STATUS_START;
  var rule = function () { return SpreadsheetApp.newConditionalFormatRule(); };
  sheet.setConditionalFormatRules([
    rule().whenFormulaSatisfied('=LEFT(' + I + ',' + S.gone.length + ')="' + S.gone + '"').setFontColor('#9A9FA6').setStrikethrough(true).setRanges([area]).build(),
    rule().whenFormulaSatisfied('=LEFT(' + I + ',' + S.waiting.length + ')="' + S.waiting + '"').setBackground('#FFFAEF').setRanges([tint]).build(),
    rule().whenFormulaSatisfied('=LEFT(' + I + ',' + S.waiting.length + ')="' + S.waiting + '"').setBackground('#FDF7DF').setFontColor('#895A00').setBold(true).setRanges([status]).build(),
    rule().whenFormulaSatisfied('=' + I + '="' + S.on + '"').setBackground('#E6F4EA').setFontColor('#137333').setBold(true).setRanges([status]).build()
  ]);
  sheet.hideColumns(W);
  SpreadsheetApp.flush();
}

// Writes only the values: the title, the counts and the phone rows (the drawing is already there).
function phonesFill_(sheet, frame, rows) {
  var first = frame.firstDataRow, size = sheet.getMaxRows() - first + 1, n = rows.length;
  sheet.getRange(2, 2).setValue(frame.rows[1][1]);
  sheet.getRange(3, 1, 1, frame.rows[2].length).setValues([frame.rows[2]]);
  var area = sheet.getRange(first, frame.firstCol, size, 9);
  area.clearContent();
  sheet.getRange(first, 5, size, 1).removeCheckboxes();
  sheet.getRange(first, 2, size, 3).setNumberFormat('@');    // names like 78E6 stay text (19 Nov)
  sheet.getRange(first, 10, size, 1).setNumberFormat('@');
  if (n) {
    sheet.getRange(first, frame.firstCol, n, 9).setValues(rows);
    sheet.getRange(first, 5, n, 1).insertCheckboxes();
  }
  SpreadsheetApp.flush();
}

// setuprun-apps-script.js - Apps Script only. The "hands" that steps.js works with (see the list at the top of
// steps.js): real web calls to Google naming the owner's Firebase project, the script's own private storage,
// gzip and fingerprints for the upload, the watcher, and the QR picture on the Setup tab.
// Every decision is in steps.js (tested offline); nothing here decides anything.

function pfsSigned_(bytes) { return bytes.map(function (b) { return b > 127 ? b - 256 : b; }); }   // 0..255 -> Apps Script's -128..127
function pfsHex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }
function pfsSha_(what) { return pfsHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, what)); }

// shown: an empty object; step 7 leaves { url, png } in it so pfsSetUp can place the QR after the tab is redrawn.
function pfsHands_(book, shown) {
  var p = PropertiesService.getScriptProperties();
  return {
    call: function (req) {
      var opt = { method: req.method, muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'x-goog-user-project': req.project } };
      if (req.raw) { opt.contentType = 'application/octet-stream'; opt.payload = req.raw; }
      else if (req.body !== undefined) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(req.body); }
      var r = UrlFetchApp.fetch(req.url, opt), code = r.getResponseCode(), text = r.getContentText(), json = {};
      try { json = JSON.parse(text) || {}; } catch (e) { json = {}; }
      // The log never holds the sign-in token; a refusal's own words are kept (they are what the tick shows).
      Logger.log(req.method + ' ' + req.url.split('?')[0].replace('https://', '').slice(0, 110) + ' -> ' + code +
        (code === 200 ? '' : ' ' + String((json.error || {}).message || text).slice(0, 200).split('\n').join(' ')));
      return { code: code, json: json };
    },
    get: function (k) { return p.getProperty(k); },
    set: function (k, v) { p.setProperty(k, String(v)); },
    remove: function (k) { p.deleteProperty(k); },
    keys: function () { return p.getKeys(); },
    scriptId: function () { return ScriptApp.getScriptId(); },
    sleep: function (ms) { Utilities.sleep(ms); },
    random: function () { return pfsSha_(Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid()); },
    pack: function (content) {
      var blob = typeof content === 'string' ? Utilities.newBlob(content, 'text/plain', 'file')
        : Utilities.newBlob(pfsSigned_(content), 'application/octet-stream', 'file');
      var gz = Utilities.gzip(blob).getBytes();
      return { hash: pfsSha_(gz), bytes: gz, mark: pfsSha_(blob.getBytes()) };
    },
    watch: function () { runTurnOn(); },   // reads the Backup check minutes from the Setup tab itself
    show: function (url, png) { shown.url = url; shown.png = png; },
    wipeDevices: function () { var t = book.getSheetByName(PHONETAB.TAB_NAME); if (t) book.deleteSheet(t); }
  };
}

// The QR picture sits on the Sign-up page row, in column E. Old pictures on the tab are removed first.
function pfsPlaceQr_(sheet, built, png) {
  sheet.getImages().forEach(function (img) { img.remove(); });
  if (!built.share || !png) return;   // in the share panel, centred in its column (sizes from SETUPTAB.sharePanel)
  var q = built.share.qr, blob = Utilities.newBlob(pfsSigned_(png), 'image/png', 'sign-up-page-qr.png');
  sheet.insertImage(blob, q.col, q.row, Math.round((built.share.width - q.size) / 2), 2).setWidth(q.size).setHeight(q.size);
}
// menu-apps-script.js - Apps Script only. The 'Push from sheet' menu (MENU in menu.js decides the words).
// Inside the owner's sheet (the copy-only sheet) the menu appears by itself when the sheet opens. In the test rig,
// which runs from outside the sheet, there is no menu: run the pfs... functions from the editor, and the words go to the log.
// Set up draws the Setup and Devices tabs and, once the settings are filled in, runs the Firebase steps (steps.js)
// with the real hands from setuprun-apps-script.js, then shows each step's tick.
function pfsBook_() { return PFS_ENV.book(); }
function pfsSay_(text) {
  Logger.log(text);
  try { SpreadsheetApp.getUi().alert(MENU.TITLE, text, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { /* no sheet open (test rig): the log has it */ }
}

// The sheet owner's Google account, for links that open in the right account (cold test 18 Nov: with two accounts
// signed in, plain links opened as the wrong one). No extra permission: it is this sheet's own owner. '' when Google
// will not say (then the links are plain and the Setup tab's warning line covers it).
// Never on the shared master: strangers read and copy it, and its links must not send them to the developer's account
// (seen 18 Nov 7pm: the master's links carried his email after it redrew).
function pfsOwner_(book) {
  if (MENU.isMaster(book.getId())) return '';
  try { var o = book.getOwner(); return o ? String(o.getEmail() || '') : ''; } catch (e) { return ''; }
}

// Runs by itself when the owner edits a cell (no permission needed). Only job: on the Setup tab, the AppSheet answer
// moves "Wait before sending" to match (SETUPTAB.afterEdit). Must never get in the way of an edit.
function onEdit(e) {
  try {
    var sheet = e && e.range && e.range.getSheet();
    if (!sheet || sheet.getName() !== SETUPTAB.TAB_NAME) return;
    var change = SETUPTAB.afterEdit(sheet.getDataRange().getDisplayValues(), e.range.getRow(), e.range.getColumn());
    if (change) sheet.getRange(change.row, change.col).setValue(change.value);
  } catch (err) { Logger.log('On edit: ' + err); }
}

function onOpen() {
  var menu = SpreadsheetApp.getUi().createMenu(MENU.TITLE);
  MENU.items().forEach(function (item) { menu.addItem(item.name, item.fn); });
  menu.addToUi();
  try { pfsCopyCheck_(pfsBook_()); } catch (e) { /* opening the sheet must never fail because of this */ }
  // Keep the "Tab with your rows" list and a renamed tab in step every time the sheet opens (18 Nov).
  try {
    var book = pfsBook_(), setup = book.getSheetByName(SETUPTAB.TAB_NAME);
    if (setup && SETUPTAB.isOurs(setup.getDataRange().getDisplayValues())) {
      var r = SETUP.read(setup.getDataRange().getDisplayValues());
      if (r.settings.tab) runFollowTab_(book, r.settings.tab);
      // New sign-ups and the owner's colour show on Devices whenever the sheet is opened.
      if (book.getSheetByName(PHONETAB.TAB_NAME)) runSyncPhones_(book, r.settings);
    }
  } catch (e) { Logger.log('On open: ' + e); /* opening the sheet must never fail because of this */ }
}

// Draws the Setup tab (keeping everything already filled in) and the Devices tab. Never draws over a tab called
// Setup that is not ours - it says so and stops. With every setting filled in it then runs the Firebase steps:
// services, web app, keys, page site, page upload, watcher, link and QR. Safe to run again at any time.
// Which sheet the Setup tab was last drawn in, kept on the tab itself (developer metadata copies with the sheet).
// In a copy it names the original, so the copy knows its Setup tab is not its own yet.
var PFS_BOOK_KEY = 'pfs-book';
function pfsMarkBook_(tab, id) {
  tab.getDeveloperMetadata().forEach(function (m) { if (m.getKey() === PFS_BOOK_KEY) m.remove(); });
  tab.addDeveloperMetadata(PFS_BOOK_KEY, id);
}

// Opened as a copy of a sheet that was set up (18 Nov, the cold test showed LIVE with someone else's link):
// keep the owner's picks, drop the Firebase project, draw it as not set up, take the QR away. Runs once per copy.
function pfsCopyCheck_(book) {
  var tab = book.getSheetByName(SETUPTAB.TAB_NAME);
  if (!tab) return;
  var was = tab.getDeveloperMetadata().filter(function (m) { return m.getKey() === PFS_BOOK_KEY; }).map(function (m) { return m.getValue(); })[0];
  if (!was || was === book.getId()) return;
  var current = tab.getDataRange().getDisplayValues();
  if (!SETUPTAB.isOurs(current)) return;
  var headers = {}, tabs = book.getSheets().map(function (s) {
    var name = s.getName(), last = s.getLastColumn();
    headers[name] = last ? s.getRange(1, 1, 1, last).getDisplayValues()[0] : [];
    return name;
  });
  var built = SETUPTAB.build({ name: book.getName(), tabs: tabs, headers: headers, owner: pfsOwner_(book) }, SETUPTAB.forCopy(current), {});
  var s = SETUP.read(built.rows).settings;
  setupDraw_(tab, built, s.colour);
  pfsPlaceQr_(tab, built, null);
  // The original's devices are not this copy's: its Devices tab starts empty (cold test: the original owner's devices were listed).
  var devices = book.getSheetByName(PHONETAB.TAB_NAME);
  if (devices) phonesDraw_(devices, PHONETAB.frame(s.appName, { on: 0, waiting: 0, gone: 0 }), [], s.colour);
  pfsMarkBook_(tab, book.getId());
}

function pfsSetUp() {
  // How long each part takes goes to the log (cold test 2: a run that only said "still to fill in" took 52 seconds).
  var clock = Date.now(), lap = function (what) { Logger.log('Set up timing - ' + what + ': ' + Math.round((Date.now() - clock) / 100) / 10 + ' s'); };
  var book = pfsBook_();
  if (MENU.isMaster(book.getId())) { pfsSay_(MENU.MASTER_SAY); return; }   // the shared master is never set up
  // Google's Allow screen lets people untick single permissions. With one missing a step would fail halfway, so ask
  // again for all of them first (Google shows its box and stops this run). Not there on older Apps Script: skipped.
  if (typeof ScriptApp.requireAllScopes === 'function') ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  lap('permissions');
  pfsCopyCheck_(book);
  lap('copy check');
  var tab = book.getSheetByName(SETUPTAB.TAB_NAME), headers = {};
  var current = tab ? tab.getDataRange().getDisplayValues() : [];
  if (tab && !SETUPTAB.isOurs(current)) {
    pfsSay_('This sheet already has a tab called ' + SETUPTAB.TAB_NAME + ' that is not ours, so nothing was changed. Rename that tab, then run Set up again.');
    return;
  }
  if (tab && SETUPTAB.isOurs(current)) {   // a renamed tab: Setup shows its new name before anything is read
    var wanted = SETUP.read(current).settings.tab;
    if (wanted) { runFollowTab_(book, wanted); current = tab.getDataRange().getDisplayValues(); }
  }
  var tabs = book.getSheets().map(function (s) {
    var name = s.getName(), last = s.getLastColumn();
    headers[name] = last ? s.getRange(1, 1, 1, last).getDisplayValues()[0] : [];
    return name;
  });
  if (!tab) tab = book.insertSheet(SETUPTAB.TAB_NAME, 0);
  current = SETUPTAB.waitFollows(current);   // AppSheet Yes with Wait still at 30 seconds -> Off (19 Nov)
  var shown = {}, io = pfsHands_(book, shown), info = { name: book.getName(), tabs: tabs, headers: headers, owner: pfsOwner_(book) };
  var built = SETUPTAB.build(info, current, STEPS.facts(io)), read = SETUP.read(built.rows), s = read.settings;
  var problems = read.problems.concat(built.stale || []);   // a picked column that is gone stops it here, not at step 6
  if (problems.length) {   // not ready for the Firebase steps yet: draw, and say what is still to fill in
    // Anything typed since the tab was read is kept (cold test 2: a project typed while Set up ran was drawn over).
    var now = SETUPTAB.waitFollows(tab.getDataRange().getDisplayValues());
    if (SETUPTAB.typedDuring(current, now).length) {
      current = now; built = SETUPTAB.build(info, current, STEPS.facts(io)); read = SETUP.read(built.rows); s = read.settings;
      problems = read.problems.concat(built.stale || []);
    }
    lap('read');
    setupDraw_(tab, built, s.colour);
    lap('Setup tab drawn');
    pfsPlaceQr_(tab, built, built.page ? STEPS.qrPicture(built.page.url) : null);
    runSyncPhones_(book, s);
    lap('Devices tab');
    pfsOrderTabs_(book, tab, s);
    pfsMarkBook_(tab, book.getId());
    pfsSay_(problems.length ? 'The Setup and ' + PHONETAB.TAB_NAME + ' tabs are ready. Still to fill in on Setup: ' + problems.join(' ') + ' Then run Set up again.'
      : 'Everything is filled in now. Run Set up again.');
    return;
  }
  try { book.toast('Setting up - this takes about a minute.', MENU.TITLE, 90); } catch (e) { /* no sheet open (test rig) */ }
  lap('read');
  var facts = STEPS.run({ project: s.firebaseProject, appName: s.appName, colour: s.colour, backupMinutes: s.backupMinutes,
    version: MENU.VERSION + (typeof PFS_BUILD === 'undefined' ? '' : '+' + PFS_BUILD), files: PFS_PAGE_FILES }, io);   // any new paste is published again
  // The steps take a minute: draw from the tab as it is NOW, so anything typed meanwhile is kept, and say so.
  var now2 = SETUPTAB.waitFollows(tab.getDataRange().getDisplayValues()), late = SETUPTAB.typedDuring(current, now2);
  lap('steps');
  built = SETUPTAB.build(info, now2, facts);
  setupDraw_(tab, built, s.colour);
  lap('Setup tab drawn');
  pfsPlaceQr_(tab, built, shown.png || (built.page ? STEPS.qrPicture(built.page.url) : null));
  runSyncPhones_(book, s);
  pfsOrderTabs_(book, tab, s);
  pfsMarkBook_(tab, book.getId());
  if (late.length) { pfsSay_(STEPS.summary(facts) + ' You changed ' + late.join(', ') + ' while Set up was running. It is kept - run Set up again to use it.'); return; }
  // Finished: open the share box with the QR straight away, because a QR placed on the sheet only shows after a
  // reload (ruling A, 18 Nov 9pm).
  if (STEPS.finished(facts)) pfsShowShare_(facts.page, s, STEPS.summary(facts));
  else pfsSay_(STEPS.summary(facts));
}

// Setup first, unless the owner said they are making an AppSheet app from this sheet: then their tab goes first,
// because AppSheet builds a new app from the first tab (18 Nov). The sheet is left showing Setup.
function pfsOrderTabs_(book, setupTab, s) {
  try {
    var theirs = s.tab ? book.getSheetByName(s.tab) : null;
    if (s.appsheetFirst && theirs) { book.setActiveSheet(theirs); book.moveActiveSheet(1); }
    else { book.setActiveSheet(setupTab); book.moveActiveSheet(1); }
    book.setActiveSheet(setupTab);
  } catch (e) { Logger.log('Could not move the tabs: ' + e.message); }
}

// Share the sign-up page: the QR code big, the link, and a Copy button, in a box over the sheet (18 Nov).
function pfsShare() {
  var page = PropertiesService.getScriptProperties().getProperty('PFS_PAGE');
  if (!page) { pfsSay_(MENU.shareMissing()); return; }
  var setup = pfsBook_().getSheetByName(SETUPTAB.TAB_NAME), s = setup ? SETUP.read(setup.getDataRange().getDisplayValues()).settings : {};
  pfsShowShare_(page, s, '');
}
// The share box: the QR big, the link and a Copy button. lead = a first line (Set up's "All done"), or ''.
function pfsShowShare_(page, s, lead) {
  var png = Utilities.base64Encode(pfsSigned_(STEPS.qrPicture(page)));
  var html = HtmlService.createHtmlOutput(MENU.shareHtml(page, png, s.appName || MENU.TITLE, s.colour, lead)).setWidth(360).setHeight(lead ? 510 : 470);
  try { SpreadsheetApp.getUi().showModalDialog(html, 'Share the sign-up page'); } catch (e) { Logger.log((lead ? lead + ' ' : '') + page); }
}

// Anything that stops it (settings still to fill in, Set up not run yet) is told to the owner in plain words.
function pfsSendTest() {
  try { pfsSendTest_(); } catch (e) { pfsSay_('Send me a test could not run: ' + String(e.message || e).replace('Setup problems: ', '').split(' | ').join(' ')); }
}
function pfsSendTest_() {
  // A copied sheet still remembers the first sheet's devices until Set up has run in it: never send to those.
  if (STEPS.isCopy(pfsHands_(pfsBook_(), {}))) { pfsSay_('This sheet is a copy and has not been set up yet. Run Set up first.'); return; }
  var book = pfsBook_(), s = runSettings_(book), phones = runSyncPhones_(book, s), byId = runPhoneRecords_();
  var list = phones.map(function (p) { return byId[p.id]; }).filter(function (ph) { return !!ph; });
  var msg = MENU.testMessage(s.appName);
  var sent = list.length ? stage3PushTo_(list, { title: msg.title, body: msg.body, at: Date.now(), navigate: PFS_ENV.page() }) : [];
  var ok = sent.filter(function (r) { return r.code >= 200 && r.code < 300; }).length;
  pfsSay_(MENU.testText({ sent: ok, failed: sent.length - ok }));
}

// Reads one version number from our GitHub page. Never changes any code. (The repo is not made yet, so for now
// this says it couldn't check.)
var PFS_VERSION_URL = 'https://raw.githubusercontent.com/sheet-works/push-from-sheet/main/VERSION';
function pfsCheckUpdate() {
  var latest = '';
  try {
    var r = UrlFetchApp.fetch(PFS_VERSION_URL, { muteHttpExceptions: true });
    if (r.getResponseCode() === 200) latest = r.getContentText();
  } catch (e) { latest = ''; }
  pfsSay_(MENU.updateText(MENU.VERSION, latest));
}

function pfsTurnOff() {
  var triggers = ScriptApp.getProjectTriggers();
  var mine = MENU.ours(triggers.map(function (t) { return t.getHandlerFunction(); }));
  mine.forEach(function (i) { ScriptApp.deleteTrigger(triggers[i]); });
  pfsSay_(MENU.offText(mine.length));
}
// The sign-up page and its worker (made by build.py from stage3/index.html and stage3/sw.js - do not edit here).
var PFS_PAGE_FILES = {"index.html": "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<title>Notifications</title>\n<link rel=\"manifest\" href=\"manifest.json\">\n<link rel=\"apple-touch-icon\" href=\"icon-180.png\">\n<meta name=\"apple-mobile-web-app-capable\" content=\"yes\">\n<meta name=\"mobile-web-app-capable\" content=\"yes\">\n<meta name=\"apple-mobile-web-app-title\" id=\"home-title\" content=\"Notifications\">\n<meta name=\"theme-color\" id=\"theme\" content=\"#ffffff\">\n<style>\n  /* The look picked 17 Nov: 'Plain, in the owner's colours' (design canvas, Plain-* artboards). */\n  * { box-sizing: border-box; }\n  body { margin: 0; background: #fff; color: #000; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }\n  #page { --accent: #1565C0; max-width: 480px; min-height: 100vh; margin: 0 auto; display: flex; flex-direction: column; }\n  .screen { display: none; flex-direction: column; flex-grow: 1; padding: 56px 24px 32px; }\n  .screen[style*=\"block\"] { display: flex !important; }\n  .tile { width: 76px; height: 76px; border-radius: 18px; background: var(--accent); overflow: hidden; flex-shrink: 0; }\n  .tile img { width: 100%; height: 100%; display: block; }\n  .small .tile { width: 40px; height: 40px; border-radius: 10px; }\n  .head { display: flex; align-items: center; gap: 12px; font-size: 18px; font-weight: 600; }\n  h1 { margin: 24px 0 0; font-size: 31px; line-height: 1.15; font-weight: 700; letter-spacing: -0.4px; }\n  h2 { margin: 28px 0 8px; font-size: 19px; font-weight: 700; }\n  p { margin: 16px 0 0; font-size: 18px; line-height: 1.45; }\n  .lead { color: #444; }\n  .grow { flex-grow: 1; min-height: 32px; }\n  .big { width: 100%; min-height: 56px; border: none; border-radius: 14px; background: var(--accent); color: #fff; font: inherit; font-size: 18px; font-weight: 600; cursor: pointer; }\n  .note { margin-top: 14px; font-size: 15px; line-height: 1.4; color: #555; text-align: center; }\n  #status { margin-top: 14px; font-size: 16px; line-height: 1.4; color: #000; text-align: center; font-weight: 600; }\n  #status:empty { display: none; }\n  .link { min-height: 44px; padding: 0 12px; border: none; background: none; font: inherit; font-size: 17px; color: #444; text-decoration: underline; cursor: pointer; align-self: center; }\n  button:focus-visible { outline: 3px solid #000; outline-offset: 3px; }\n  ol { margin: 24px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 18px; }\n  ol li { display: flex; gap: 14px; align-items: flex-start; font-size: 18px; line-height: 1.4; }\n  ol li .n { width: 32px; height: 32px; flex-shrink: 0; border-radius: 16px; background: var(--accent); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 700; }\n  ol li span:last-child { padding-top: 3px; }\n  .row { display: flex; gap: 12px; padding: 14px 0; border-top: 1px solid #DADADA; }\n  .row .t { display: flex; flex-direction: column; gap: 2px; flex-grow: 1; min-width: 0; }\n  .row b { font-size: 17px; font-weight: 600; }\n  .row .m { font-size: 16px; color: #444; overflow-wrap: anywhere; }\n  .row .w { font-size: 15px; color: #555; white-space: nowrap; font-variant-numeric: tabular-nums; }\n  .empty { padding: 14px 0; border-top: 1px solid #DADADA; color: #555; font-size: 16px; }\n  details { margin-top: 24px; font-size: 13px; color: #777; }\n  details summary { cursor: pointer; }\n  details p { font-size: 13px; color: #777; margin-top: 6px; }\n</style>\n</head>\n<body>\n<div id=\"page\">\n\n  <!-- 1. Before: turn on -->\n  <section class=\"screen\" id=\"scr-before\">\n    <div class=\"tile\"><img src=\"icon-192.png\" alt=\"\"></div>\n    <h1 id=\"title-before\">Get notifications</h1>\n    <p class=\"lead\" id=\"lead-before\"></p>\n    <div class=\"grow\"></div>\n    <button type=\"button\" class=\"big\" id=\"on\">Turn on notifications</button>\n    <div id=\"status\"></div>\n    <p class=\"note\" id=\"note-before\">You'll be asked to allow them. No account or email needed.</p>\n  </section>\n\n  <!-- 2. iPhone in Safari: add to the Home Screen first -->\n  <section class=\"screen\" id=\"scr-iphone\">\n    <div class=\"head small\"><div class=\"tile\"><img src=\"icon-192.png\" alt=\"\"></div><span class=\"appname\"></span></div>\n    <h1 id=\"title-iphone\">First, add this to your Home Screen</h1>\n    <p class=\"lead\">iPhones only allow notifications from apps on the Home Screen.</p>\n    <ol>\n      <li><span class=\"n\">1</span><span>Tap the Share button <svg aria-hidden=\"true\" width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#000\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"vertical-align:-3px\"><path d=\"M12 15V3\"/><path d=\"M8 7l4-4 4 4\"/><path d=\"M6 11H5v10h14V11h-1\"/></svg>. It is at the bottom of Safari, or behind the three-lines button beside the address.</span></li>\n      <li><span class=\"n\">2</span><span>Choose <b>Add to Home Screen</b>, then <b>Add</b></span></li>\n      <li><span class=\"n\">3</span><span id=\"step3\">Open it from your Home Screen and turn on notifications there</span></li>\n    </ol>\n  </section>\n\n  <!-- 3. On -->\n  <section class=\"screen\" id=\"scr-on\">\n    <div class=\"head small\"><div class=\"tile\"><img src=\"icon-192.png\" alt=\"\"></div><span class=\"appname\" id=\"appname\"></span></div>\n    <svg id=\"tick-on\" role=\"img\" aria-label=\"On\" width=\"44\" height=\"44\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"margin-top:36px;color:var(--accent)\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M7.5 12.5l3 3 6-6.5\"/></svg>\n    <h1 id=\"title-on\" style=\"margin-top:8px\">Notifications are on</h1>\n    <p class=\"lead\" id=\"devname\" style=\"margin-top:8px\"></p>\n    <h2>Recent</h2>\n    <div id=\"recent\"></div>\n    <div class=\"grow\"></div>\n    <button type=\"button\" class=\"link\" id=\"off\">Turn off notifications</button>\n  </section>\n\n  <!-- 4. Blocked -->\n  <section class=\"screen\" id=\"scr-blocked\">\n    <div class=\"head small\"><div class=\"tile\"><img src=\"icon-192.png\" alt=\"\"></div><span class=\"appname\"></span></div>\n    <h1 id=\"title-blocked\">Notifications are blocked</h1>\n    <p class=\"lead\" id=\"lead-blocked\"></p>\n    <h2 id=\"fix-head\"></h2>\n    <p id=\"fix-how\"></p>\n    <div class=\"grow\"></div>\n    <button type=\"button\" class=\"big\" id=\"again\">Try again</button>\n  </section>\n\n  <div style=\"padding: 0 24px 24px\">\n    <details><summary>About this page</summary><p id=\"facts\"></p><p id=\"version\"></p></details>\n  </div>\n</div>\n<script src=\"config.js\"></script>\n<script>\n  var $ = function (id) { return document.getElementById(id); };\n  var PAGE_VERSION = 'v11'; // change with every upload of index.html; the worker has its own (WORKER_VERSION in sw.js)\n  var REG = null; // the service worker registration, kept ready so the click can ask straight away (Safari needs that)\n  var COLOUR_SHAPE = /^#[0-9A-Fa-f]{6}$/;\n  var DEFAULT_COLOUR = '#1565C0';\n  function cfg() { return typeof CONFIG === 'undefined' ? {} : CONFIG; }\n  function appName() { return String(cfg().name || '').trim() || 'this app'; }\n  function say(t) { $('status').textContent = t; }\n  // One screen at a time: before, iphone, on, blocked.\n  function show(name) {\n    ['before', 'iphone', 'on', 'blocked'].forEach(function (n) { $('scr-' + n).style.display = n === name ? 'block' : 'none'; });\n  }\n  function facts() {\n    var v = (navigator.userAgent.match(/(Version|Chrome|Firefox)\\/[\\d.]+/) || ['?'])[0];\n    return 'secure page: ' + window.isSecureContext + ', permission: ' + permission() +\n      ', push: ' + ('PushManager' in window) + ', home screen app: ' + isHomeScreenApp() + ', browser: ' + v;\n  }\n  function permission() { return window.Notification ? window.Notification.permission : 'no Notification'; }\n  function isIphone() { return /iPhone|iPad|iPod/.test(navigator.userAgent); }\n  function isHomeScreenApp() { return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches; }\n  // 'phone', 'iPad' or 'computer' - the words on the page follow the device.\n  function kind() {\n    var ua = navigator.userAgent;\n    if (/iPad/.test(ua)) return 'iPad';\n    return /iPhone|iPod|Android/.test(ua) ? 'phone' : 'computer';\n  }\n  // A plain name for this kind of device, shown on the owner's Devices tab (e.g. 'iPhone, Home Screen', 'Android, Chrome').\n  function deviceName() {\n    var ua = navigator.userAgent;\n    var browser = /SamsungBrowser\\//.test(ua) ? 'Samsung Internet' : /Edg\\//.test(ua) ? 'Edge' : /Firefox\\//.test(ua) ? 'Firefox' : /Chrome\\//.test(ua) ? 'Chrome' : /Safari\\//.test(ua) ? 'Safari' : '';\n    if (/iPhone|iPad|iPod/.test(ua)) return (/iPad/.test(ua) ? 'iPad' : 'iPhone') + (isHomeScreenApp() ? ', Home Screen' : ', Safari');\n    var os = /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';\n    return os && browser ? os + ', ' + browser : 'Other';\n  }\n  // An email the AppSheet link can add to the page address (?email=...). Passed on so Push To can use it.\n  function emailFromAddress() {\n    try { return new URLSearchParams(location.search).get('email') || ''; } catch (e) { return ''; }\n  }\n  function toBytes(b64url) {\n    var s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/'));\n    return Uint8Array.from(s, function (c) { return c.charCodeAt(0); });\n  }\n  function newId() { // 32 letters and digits, made on this device\n    var b = new Uint8Array(16); crypto.getRandomValues(b);\n    return Array.from(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');\n  }\n  function escape(t) {\n    return String(t === undefined || t === null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');\n  }\n  async function readSetup() {\n    var r = await (await caches.open('push-setup')).match('/setup.json');\n    return r ? r.json() : null;\n  }\n  async function saveSetup(setup) {\n    await (await caches.open('push-setup')).put('/setup.json', new Response(JSON.stringify(setup)));\n  }\n  async function askScript(query) {\n    var res = await fetch(cfg().script + '?' + query, { cache: 'no-store' });\n    return res.json();\n  }\n  // The two encryption keys the browser hands over with its push address. The sheet locks the words with them,\n  // so version 1 cannot sign a device up without both. Gives null when either is missing.\n  function keysOf(sub) {\n    var keys = (sub && sub.toJSON && sub.toJSON().keys) || {};\n    return keys.p256dh && keys.auth ? keys : null;\n  }\n  // What the page sends the sheet at sign-up: this device's id, its push address, and the two keys.\n  function subscribeQuery(id, sub) {\n    var keys = keysOf(sub);\n    var email = emailFromAddress();\n    return 'action=subscribe&id=' + id + '&endpoint=' + encodeURIComponent(sub.endpoint) +\n      '&p256dh=' + encodeURIComponent(keys.p256dh) + '&auth=' + encodeURIComponent(keys.auth) +\n      '&device=' + encodeURIComponent(deviceName()) + (email ? '&email=' + encodeURIComponent(email) : '');\n  }\n  function when(iso) {\n    var d = new Date(iso);\n    if (isNaN(d)) return '';\n    var now = new Date(), day = 86400000;\n    var time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase();\n    if (d.toDateString() === now.toDateString()) return time;\n    if (d.toDateString() === new Date(now - day).toDateString()) return 'Yesterday';\n    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });\n  }\n  // Recent: the last notifications this device got, newest first. Asked of the sheet, which keeps each device's last 10\n  // (18 Nov: on iPhone the worker's own log never reaches the page). If the sheet cannot be reached, the device's own log.\n  async function recentFromSheet() {\n    var setup = await readSetup();\n    if (!setup || !cfg().script) return null;\n    try {\n      var a = await askScript('action=recent&id=' + setup.id);\n      if (a && a.ok) { WAITING = a.waiting === true; paintOn(); }   // the sheet knows whether the owner has let this device in\n      return a && a.ok && a.recent ? a.recent.map(function (m) { return { shown: m.title, body: m.body, at: m.at }; }) : null;\n    } catch (e) { return null; }\n  }\n  async function showLog() {\n    var list = await recentFromSheet();\n    if (!list) {\n      var r = await (await caches.open('push-log')).match('/push-log.json');\n      list = r ? (await r.json()).slice().reverse() : [];\n    }\n    $('recent').innerHTML = list.length ? list.slice(0, 10).map(function (e) {\n      return '<div class=\"row\"><div class=\"t\"><b>' + escape(e.shown) + '</b>' + (e.body ? '<span class=\"m\">' + escape(e.body) + '</span>' : '') +\n        '</div><span class=\"w\">' + escape(when(e.at)) + '</span></div>';\n    }).join('') : '<div class=\"empty\">Nothing yet. New notifications will show here too.</div>';\n  }\n  function showVersion(worker) {\n    var t = 'page ' + PAGE_VERSION + ', worker ' + (worker || 'not known');\n    if (worker && worker !== PAGE_VERSION) t += ' - an older worker is still running, close the app and open it again';\n    $('version').textContent = t;\n  }\n  function askVersion() { // a worker older than v4 never answers, so the line stays 'not known'\n    var w = REG && (REG.active || REG.waiting || REG.installing);\n    if (w) w.postMessage({ type: 'version?' });\n  }\n  // The owner's name and colour, from config.js (written by Set up).\n  function dress() {\n    var name = appName(), k = kind(), colour = COLOUR_SHAPE.test(String(cfg().colour || '')) ? cfg().colour : DEFAULT_COLOUR;\n    $('page').style.setProperty('--accent', colour);\n    var theme = $('theme'); if (theme && theme.setAttribute) theme.setAttribute('content', colour);\n    var home = $('home-title'); if (home && home.setAttribute && cfg().name) home.setAttribute('content', name);\n    if (cfg().name) document.title = name;\n    $('appname').textContent = name;\n    if (document.querySelectorAll) Array.prototype.forEach.call(document.querySelectorAll('.appname'), function (e) { e.textContent = name; });\n    $('title-before').textContent = 'Get notifications from ' + name + ' on this ' + k;\n    $('lead-before').textContent = 'When ' + name + ' sends something new, it pops up on this ' + k + (k === 'phone' ? ' like a text message.' : '.');\n    $('title-iphone').textContent = 'First, add ' + name + ' to your Home Screen';\n    $('step3').textContent = 'Open ' + name + ' from your Home Screen and turn on notifications there';\n    $('title-blocked').textContent = 'Notifications are blocked on this ' + k;\n    $('lead-blocked').textContent = 'This ' + k + ' said no to notifications from ' + name + '. Only its settings can change that.';\n    var ua = navigator.userAgent;\n    if (/iPhone|iPad|iPod/.test(ua)) { $('fix-head').textContent = 'iPhone'; $('fix-how').textContent = 'Settings, then Notifications, then ' + name + '. Turn on Allow Notifications.'; }\n    else if (/Android/.test(ua)) { $('fix-head').textContent = 'Android'; $('fix-how').textContent = 'Press and hold the ' + name + ' icon, tap App info, then Notifications, and turn them on.'; }\n    else { $('fix-head').textContent = 'On a computer'; $('fix-how').textContent = 'Click the icon at the left of the address bar, find Notifications, and choose Allow. Then tap Try again.'; }\n  }\n  // v10 (cold test 18 Nov: the page said ON while the device was still waiting for the owner): the On screen says which\n  // it is. The sheet's answers say when a device is waiting - the sign-up answer, and the Recent answer on every open.\n  var NAME = '', WAITING = false;\n  function paintOn() {\n    if (!NAME) return;\n    $('title-on').textContent = WAITING ? 'Waiting to be let in' : 'Notifications are on';\n    $('tick-on').style.display = WAITING ? 'none' : '';   // v11: a tick beside \"waiting\" reads like it is already on\n    $('devname').textContent = 'This ' + kind() + \"'s name is \" + NAME + '.' + (WAITING ? ' Notifications start once the owner of ' + appName() + ' lets it in.' : '');\n  }\n  function signedUpAs(name, waiting) {\n    NAME = name; WAITING = waiting === true;\n    paintOn();\n    show('on');\n    showLog().catch(function () {});\n  }\n  async function start() {\n    showVersion(null);\n    dress();\n    show('before');\n    $('facts').textContent = facts();\n    if (!cfg().script || String(cfg().script).indexOf('https://') !== 0) {\n      say('This page has not been set up yet. Ask whoever sent you the link.');\n      $('on').style.display = 'none'; $('note-before').style.display = 'none';\n      return;\n    }\n    if (isIphone() && !isHomeScreenApp()) { show('iphone'); return; }\n    if (permission() === 'denied') { show('blocked'); return; }\n    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {\n      say('This browser cannot get notifications from a page. Try Chrome, Edge, Firefox or Safari.');\n      $('on').style.display = 'none';\n      return;\n    }\n    REG = await navigator.serviceWorker.register('sw.js');\n    await navigator.serviceWorker.ready;\n    askVersion();\n    var sub = await REG.pushManager.getSubscription();\n    var setup = await readSetup();\n    if (sub && setup) signedUpAs(setup.id.slice(0, 4).toUpperCase());\n    // Already signed up: quietly send the sign-up again, so the sheet has this device's current address and its two keys.\n    if (sub && setup && keysOf(sub)) askScript(subscribeQuery(setup.id, sub)).catch(function () {});\n  }\n  // The browser must be asked DIRECTLY from the tap, with nothing in between (Safari shows no Allow box otherwise).\n  $('on').onclick = function () {\n    if (!REG) { say('Not ready yet - wait a second and tap again.'); return; }\n    say('Look for a box asking to allow notifications.');\n    var timer = setTimeout(function () { say('No answer after 15 seconds. Close this page, open it again and tap Turn on.'); }, 15000);\n    REG.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(cfg().publicKey) }).then(async function (sub) {\n      clearTimeout(timer);\n      if (!keysOf(sub)) { say('This browser did not hand over its encryption keys, so it cannot get notifications. Close the app, open it again and tap Turn on.'); return; }\n      say('Allowed. Signing up...');\n      var setup = (await readSetup()) || { script: cfg().script, id: newId() };\n      setup.script = cfg().script;\n      await saveSetup(setup);\n      var answer = await askScript(subscribeQuery(setup.id, sub));\n      if (answer && answer.ok) { say(''); signedUpAs(answer.name, answer.waiting); }\n      else say('Allowed here, but the sign-up was refused: ' + (answer && answer.error));\n      $('facts').textContent = facts();\n    }).catch(function (e) {\n      clearTimeout(timer);\n      $('facts').textContent = facts();\n      if (permission() === 'denied') { say(''); show('blocked'); return; }\n      say('That did not work (' + e.name + '). Tap Turn on to try again.');\n    });\n  };\n  $('off').onclick = async function () {\n    try {\n      var setup = await readSetup();\n      var sub = REG ? await REG.pushManager.getSubscription() : null;\n      if (sub) await sub.unsubscribe();\n      if (setup) await askScript('action=unsubscribe&id=' + setup.id);\n      show('before');\n      say('Notifications are off on this ' + kind() + '.');\n    } catch (e) { say('Problem turning off: ' + e.name + ': ' + e.message); }\n  };\n  $('again').onclick = function () { location.reload(); };\n  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', function (e) {\n    if (e.data && e.data.type === 'version') showVersion(e.data.worker); else showLog();\n  });\n  // Re-read Recent whenever the page comes back to the front (an app left open showed old pushes, 17 Nov).\n  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') showLog().catch(function () {}); });\n  window.addEventListener('pageshow', function () { showLog().catch(function () {}); });\n  start().catch(function (e) { say('Problem starting: ' + e.name + ': ' + e.message); });\n</script>\n</body>\n</html>\n", "sw.js": "// sw.js - the service worker for the phone page.\n// Version 1 (ruling 17 Nov 2026): the sheet locks the words and puts them INSIDE the push; the browser unlocks them\n// before this worker sees them. The worker never calls the sheet back.\n// Seen live 17 Nov: on iPhone (iOS 27.2) Apple draws these pushes itself and this worker does not run for them.\n// On Android and computers this worker draws the notification.\n// It must ALWAYS show a notification (Safari takes the permission away otherwise), so a push with no readable words\n// still shows plain fall-back words.\n\nvar WORKER_VERSION = 'v11'; // shown on the page so you can see which worker the phone is really running. Change with every upload of sw.js.\n\nself.addEventListener('install', function () { self.skipWaiting(); });\nself.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });\n\n// iPhone does NOT replace a notification that has the same tag (seen 17 Nov: a nudged iPhone showed one job twice).\n// So before showing, the worker closes any notification already showing with the same tag itself.\n// It must still show one every time - iPhone needs a shown notification for every push.\nasync function showOnce(title, options) {\n  try {\n    var same = await self.registration.getNotifications({ tag: options.tag });\n    same.forEach(function (n) { n.close(); });\n  } catch (e) { /* older browsers: fall back to the tag alone */ }\n  await self.registration.showNotification(title, options);\n}\n\n// Pushes are handled one at a time, so a repeat that lands while the first is still busy\n// waits its turn and then replaces it, instead of both checking at once and both showing.\nvar queue = Promise.resolve();\n\nself.addEventListener('push', function (event) {\n  var started = Date.now();\n  var carried = readCarried(event.data);\n  var job = queue.then(function () { return handlePush(started, carried); });\n  queue = job.catch(function () {});\n  event.waitUntil(job);\n});\n\n// Words carried INSIDE the push (17 Nov): { web_push: 8030, notification: { title, body, tag, navigate } }.\n// The browser has already unlocked them. Anything not in that shape gives null, and the fall-back words are shown.\nfunction readCarried(data) {\n  try {\n    var m = data && data.json();\n    var n = m && m.web_push === 8030 && m.notification;\n    if (!n || typeof n.title !== 'string' || !n.title) return null;\n    return { title: n.title, body: typeof n.body === 'string' ? n.body : '', tag: typeof n.tag === 'string' && n.tag ? n.tag : '',\n      navigate: typeof n.navigate === 'string' && n.navigate.indexOf('https://') === 0 ? n.navigate : '' };\n  } catch (e) { return null; }\n}\n\nasync function handlePush(started, carried) {\n  {\n    var title = 'New message', body = 'Open the app to see it.', how = 'no words in the push';\n    var tag = 'push-from-sheet-fallback-' + started, navigate = '';\n    if (carried) {\n      title = carried.title; body = carried.body; how = 'carried in the push';\n      tag = carried.tag || 'push-from-sheet-carried-' + started; navigate = carried.navigate;\n    }\n    try {\n      var cache = await caches.open('push-log');\n      var old = await cache.match('/push-log.json');\n      var list = old ? await old.json() : [];\n      list.push({ at: new Date(started).toISOString(), words: how, tookMs: Date.now() - started, shown: title, body: body });\n      await cache.put('/push-log.json', new Response(JSON.stringify(list.slice(-20))));\n    } catch (e) { /* the log is a nice-to-have */ }\n    await showOnce(title, { body: body, icon: 'icon-192.png', tag: tag, data: { navigate: navigate } });\n    var pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });\n    pages.forEach(function (p) { p.postMessage({ type: 'push-arrived' }); });\n  }\n}\n\n// The page asks 'version?' when it opens; answer with this worker's version.\nself.addEventListener('message', function (event) {\n  if (event.data && event.data.type === 'version?' && event.source) event.source.postMessage({ type: 'version', worker: WORKER_VERSION });\n});\n\n// Tapping opens the address the push carried (e.g. the AppSheet record), or the page itself. Only https is ever opened.\nself.addEventListener('notificationclick', function (event) {\n  event.notification.close();\n  var d = event.notification.data, go = d && typeof d.navigate === 'string' && d.navigate.indexOf('https://') === 0 ? d.navigate : './';\n  event.waitUntil(self.clients.openWindow(go));\n});\n"};
// env-share-apps-script.js - Apps Script only. For the sheet we share: the script lives INSIDE the owner's
// sheet, reads its Setup tab, sends to every device the owner let in, and keeps its own sending key and page
// address in its own private storage (Set up makes them - the Firebase steps).
var PFS_ENV = {
  book: function () { return SpreadsheetApp.getActiveSpreadsheet(); },
  setupTab: 'Setup',
  oldPhonesTab: '',
  keyProp: 'PFS_SENDING_KEY',
  page: function () { return PropertiesService.getScriptProperties().getProperty('PFS_PAGE') || ''; },
  signup: function () {
    var tab = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Setup');
    return tab ? SETUP.read(tab.getDataRange().getDisplayValues()).settings.signup : 'approve';
  },
  keep: function (phones) { return phones; }
};

// Build stamp (made by build.py from everything above).
var PFS_BUILD = '2093959992';
