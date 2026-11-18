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
