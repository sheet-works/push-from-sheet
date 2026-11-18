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

