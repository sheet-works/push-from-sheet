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
