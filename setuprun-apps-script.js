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
