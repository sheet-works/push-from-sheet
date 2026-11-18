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
