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
