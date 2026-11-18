// test-steps.js - steps.js is Set up's Firebase steps: ONE list of steps, run in order, stopping at the first that
// fails with plain words for its tick. It never touches Apps Script itself: the caller hands it "hands" (io) for
// web calls, storage, sleeping and so on. Here the hands are a pretend Google, so the whole run is tested offline.
// The shapes of Google's answers are the ones seen live 17-18 Nov 2026 (HANDOVER.md).
// Run:  node --test test-steps.js
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const STEPS = require('./steps.js');
const ES256 = require('./es256.js');
const SETUP = require('./setup.js');
const PNG = require('./png.js');
const QR = require('./qr.js');

const NAMES = ['Switch on services', 'Publish as a web app', 'Make the keys', 'Make the page site', 'Upload the sign-up page', 'Turn on the watcher', 'Page link and QR code'];
const CTX = () => ({ project: 'smith-cutting-push', appName: 'Smith Cutting', colour: '#2E7D32', backupMinutes: 10, version: '1.0',
  files: { 'index.html': '<!doctype html><title>page</title>', 'sw.js': '// worker' } });
const SWITCH_OFF = 'The "Google Apps Script API" switch is off for this Google account. Open https://script.google.com/home/usersettings and turn it On, wait a minute, then run Set up again.';
const err = (code, message) => ({ code: code, json: { error: { code: code, message: message } } });

function world() {
  const w = { props: {}, calls: [], slept: 0, shown: null, watched: null, wiped: 0, id: 'SCRIPT-ONE', rand: 0,
    version: 0, deployments: 0, sites: {}, stored: {}, live: {}, refuseSites: 0, opPolls: 0 };
  w.io = {
    get: (k) => (k in w.props ? w.props[k] : null),
    set: (k, v) => { w.props[k] = String(v); },
    remove: (k) => { delete w.props[k]; },
    keys: () => Object.keys(w.props),
    scriptId: () => w.id,
    sleep: (ms) => { w.slept += ms; },
    random: () => (w.badRandom ? '0'.repeat(64) : (++w.rand).toString(16).padStart(2, '0').repeat(32)),
    pack: (content) => {
      const plain = Buffer.from(typeof content === 'string' ? content : Uint8Array.from(content));
      const bytes = zlib.gzipSync(plain);
      if (w.gzipWobbles) bytes.writeUInt32LE(++w.gzipWobbles, 4);   // a gzip with the time written inside: different bytes every time
      return { hash: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: [...bytes], mark: crypto.createHash('sha256').update(plain).digest('hex') };
    },
    watch: (minutes) => { if (w.watchFails) throw new Error(w.watchFails); w.watched = minutes; },
    show: (url, png) => { w.shown = { url: url, png: png }; },
    wipeDevices: () => { w.wiped++; },
    call: (req) => { w.calls.push(req); if (w.callThrows) throw new Error(w.callThrows); return google(w, req); }
  };
  return w;
}
function google(w, req) {
  const u = req.url, m = req.method;
  let x;
  if (w.failAt && new RegExp(w.failAt).test(m + ' ' + u)) return err(w.failCode || 500, google.broken || 'broken');
  if (u.indexOf('https://serviceusage.googleapis.com/v1/projects/') === 0 && /:enable$/.test(u)) {
    if (w.unknownProject) return err(w.unknownProject === true ? 403 : w.unknownProject, w.unknownMessage || 'Permission denied to enable service [firebasehosting.googleapis.com]');
    if (w.terms) return err(400, w.terms === true ? "The terms of service 'script' for service(s) 'script.googleapis.com,script.googleapis.com' must be accepted. Please visit the Developers Console to accept the terms of service (https://console.developers.google.com/terms/script)." : w.terms);
    return { code: 200, json: { name: 'operations/op-' + u.split('/services/')[1], done: !w.opPolls } };
  }
  if (u.indexOf('https://serviceusage.googleapis.com/v1/operations/') === 0) return { code: 200, json: { done: --w.opPolls <= 0 } };
  if (u === 'https://script.googleapis.com/v1/projects/' + w.id && m === 'get') {
    if (w.switchOff) return err(403, 'User has not enabled the Apps Script API. Enable it by visiting https://script.google.com/home/usersettings then retry.');
    if (w.apiNotReady) return err(403, 'Apps Script API has not been used in project 112133585837 before or it is disabled.');
    return { code: 200, json: { scriptId: w.id } };
  }
  if (w.switchOffForWrites && u.indexOf('https://script.googleapis.com/v1/projects/' + w.id + '/') === 0) return err(403, 'User has not enabled the Apps Script API. Enable it by visiting https://script.google.com/home/usersettings then retry. If you enabled this API recently, wait a few minutes for the action to propagate to our systems and retry.');
  if (u === 'https://script.googleapis.com/v1/projects/' + w.id + '/versions') return { code: 200, json: { versionNumber: ++w.version } };
  const web = (id) => ({ deploymentId: id, entryPoints: [{ entryPointType: 'EXECUTION_API' }, { entryPointType: 'WEB_APP', webApp: { url: 'https://script.google.com/macros/s/' + id + '/exec' } }] });
  if (u === 'https://script.googleapis.com/v1/projects/' + w.id + '/deployments' && m === 'post') return { code: 200, json: w.noWebApp ? { deploymentId: 'X' } : web('DEP' + (++w.deployments)) };
  if ((x = /\/deployments\/(\w+)$/.exec(u)) && m === 'put') return w.deploymentGone ? err(404, 'Requested entity was not found.') : { code: 200, json: web(x[1]) };
  const H = 'https://firebasehosting.googleapis.com/v1beta1/';
  if ((x = new RegExp('^' + H + 'projects/([^/]+)/sites/([^/?]+)$').exec(u)) && m === 'get') return w.sites[x[2]] ? { code: 200, json: { name: 'projects/' + x[1] + '/sites/' + x[2] } } : err(404, 'not found');
  if ((x = new RegExp('^' + H + 'projects/([^/]+)/sites\\?siteId=(.+)$').exec(u)) && m === 'post') {
    if (w.sitesBroken) return err(500, 'Internal error');
    if (w.refuseSites-- > 0) return err(w.refuseCode || 400, 'Invalid name: `' + x[2] + '` is invalid; try something like `fir-1081d` instead');
    w.sites[x[2]] = x[1];
    return { code: 200, json: { name: 'projects/' + x[1] + '/sites/' + x[2], defaultUrl: 'https://' + x[2] + '.web.app', type: 'USER_SITE' } };
  }
  if ((x = new RegExp('^' + H + 'sites/([^/]+)/versions$').exec(u)) && m === 'post') return { code: 200, json: { name: 'sites/' + x[1] + '/versions/v' + (++w.version), status: 'CREATED' } };
  if (/:populateFiles$/.test(u)) {
    w.listed = req.body.files;
    const need = Object.keys(req.body.files).map((p) => req.body.files[p]).filter((h) => !(h in w.stored));
    return { code: 200, json: { uploadRequiredHashes: need, uploadUrl: 'https://upload-firebasehosting.googleapis.com/upload/' + u.slice(H.length).replace(':populateFiles', '') + '/files' } };
  }
  if (u.indexOf('https://upload-firebasehosting.googleapis.com/upload/') === 0) {
    if (w.uploadFails) return err(503, 'try later');
    const hash = u.split('/').pop();
    assert.strictEqual(crypto.createHash('sha256').update(Buffer.from(req.raw)).digest('hex'), hash, 'uploaded bytes match their name');
    w.stored[hash] = Buffer.from(req.raw);
    return { code: 200, json: {} };
  }
  if (/\?update_mask=status$/.test(u) && m === 'patch') return { code: 200, json: { status: 'FINALIZED' } };
  if ((x = new RegExp('^' + H + 'sites/([^/]+)/releases\\?versionName=(.+)$').exec(u)) && m === 'post') {
    if (w.releaseFails) return err(500, 'backend error');
    w.live[x[1]] = {};
    Object.keys(w.listed).forEach((p) => { w.live[x[1]][p] = zlib.gunzipSync(w.stored[w.listed[p]]); });
    return { code: 200, json: { name: 'sites/' + x[1] + '/releases/1' } };
  }
  throw new Error('pretend Google has no answer for ' + m + ' ' + u);
}
const okAll = (facts) => NAMES.every((n) => facts.steps[n] && facts.steps[n].ok === true);
const stoppedAt = (facts, name) => {
  const i = NAMES.indexOf(name);
  NAMES.slice(0, i).forEach((n) => assert.deepStrictEqual(facts.steps[n], { ok: true }, n + ' passed first'));
  assert.ok(facts.steps[name] && facts.steps[name].error, name + ' has an error');
  NAMES.slice(i + 1).forEach((n) => assert.strictEqual(facts.steps[n], undefined, n + ' was not tried'));
  return facts.steps[name].error;
};
const did = (w, method, part) => w.calls.filter((c) => c.method === method && c.url.indexOf(part) >= 0).length;

test('one list: seven steps, in the order the work has to happen', () => {
  assert.deepStrictEqual(STEPS.names(), NAMES);
});

test('a first run with everything right: every step passes and the page is live with this sheet\'s own address and key', () => {
  const w = world(), facts = STEPS.run(CTX(), w.io);
  assert.ok(okAll(facts), JSON.stringify(facts.steps));
  assert.strictEqual(facts.apiSwitch, true);
  assert.strictEqual(facts.fresh, false);
  assert.ok(w.calls.every((c) => c.project === 'smith-cutting-push'), 'every call names the owner\'s project');
  // services: both switched on
  assert.strictEqual(did(w, 'post', '/services/firebasehosting.googleapis.com:enable'), 1);
  assert.strictEqual(did(w, 'post', '/services/script.googleapis.com:enable'), 1);
  // web app
  assert.strictEqual(w.props.PFS_WEBAPP, 'https://script.google.com/macros/s/DEP1/exec');
  assert.strictEqual(w.props.PFS_DEPLOYMENT, 'DEP1');
  // key: 64 hex, kept under the name the sender reads
  assert.match(w.props.PFS_SENDING_KEY, /^[0-9a-f]{64}$/);
  // site: made in the project, named after the app
  const site = w.props.PFS_SITE;
  assert.match(site, /^smith-cutting-[0-9a-f]{6}$/);
  assert.strictEqual(w.sites[site], 'smith-cutting-push');
  assert.strictEqual(w.props.PFS_PAGE, 'https://' + site + '.web.app/');
  assert.strictEqual(facts.page, w.props.PFS_PAGE);
  // page: seven files live; config.js carries THIS web app and THIS key's public half
  const live = w.live[site];
  assert.deepStrictEqual(Object.keys(live).sort(), ['/config.js', '/icon-180.png', '/icon-192.png', '/icon-512.png', '/index.html', '/manifest.json', '/sw.js']);
  assert.strictEqual(live['/index.html'].toString(), CTX().files['index.html']);
  const CONFIG = new Function(live['/config.js'].toString() + '; return CONFIG;')();
  assert.strictEqual(CONFIG.script, 'https://script.google.com/macros/s/DEP1/exec');
  assert.strictEqual(CONFIG.publicKey, ES256.b64url(ES256.publicKey(w.props.PFS_SENDING_KEY)));
  assert.strictEqual(CONFIG.name, 'Smith Cutting');
  assert.strictEqual(CONFIG.colour, '#2E7D32');
  // watcher and link
  assert.strictEqual(w.watched, 10);
  assert.strictEqual(w.shown.url, w.props.PFS_PAGE);
  assert.deepStrictEqual(w.shown.png, PNG.encode(QR.matrix(w.props.PFS_PAGE), [[255, 255, 255], [0, 0, 0]], 6, 4), 'the QR code of the page address, black on white, 4 cells of white round it');
  // remembered for the ticks
  assert.deepStrictEqual(STEPS.facts(w.io), { apiSwitch: true, steps: facts.steps, page: facts.page });
  assert.strictEqual(w.props.PFS_SCRIPT_ID, 'SCRIPT-ONE');
});

test('running it again with nothing changed does no work twice: it only looks', () => {
  const w = world();
  STEPS.run(CTX(), w.io);
  const before = JSON.stringify(w.props);
  w.calls.length = 0; w.shown = null; w.watched = null;
  const facts = STEPS.run(CTX(), w.io);
  assert.ok(okAll(facts));
  assert.deepStrictEqual(w.calls.map((c) => c.method + ' ' + c.url.split('/v1')[0].replace('https://', '')), ['get script.googleapis.com', 'get firebasehosting.googleapis.com']);
  assert.strictEqual(JSON.stringify(w.props), before);
  assert.strictEqual(w.watched, 10, 'the watcher is set again (the Backup check setting may have changed)');
  assert.ok(w.shown, 'the link and QR are drawn again (the tab was redrawn)');
});

test('Google does not know the project: step 1 fails, says so with the name, and nothing after it is tried', () => {
  const w = world(); w.unknownProject = true;
  const words = stoppedAt(STEPS.run(CTX(), w.io), 'Switch on services');
  assert.strictEqual(words, 'Google does not know a Firebase project called "smith-cutting-push" on this Google account. Open your project in Firebase, copy the address from the address bar and paste it into "Firebase project address" on Setup.');
  assert.strictEqual(w.calls.length, 1);
  assert.strictEqual(w.props.PFS_PROJECT, undefined);
});

test('Google answers "not found" for the project: the same words as "does not know"', () => {
  const w = world(); w.unknownProject = 404;
  assert.match(stoppedAt(STEPS.run(CTX(), w.io), 'Switch on services'), /^Google does not know a Firebase project called "smith-cutting-push"/);
});

test('Google answers 400 "not found or deleted" for the project (cold test 2, 18 Nov): the same words as "does not know"', () => {
  const w = world(); w.unknownProject = 400; w.unknownMessage = "Project 'projects/smith-cutting-push' not found or deleted.";
  assert.match(stoppedAt(STEPS.run(CTX(), w.io), 'Switch on services'), /^Google does not know a Firebase project called "smith-cutting-push"/);
  assert.strictEqual(w.calls.length, 1);
});

test('any other 400 at step 1 still shows Google\'s own words', () => {
  const w = world(); w.unknownProject = 400; w.unknownMessage = 'Request contains an invalid argument.';
  assert.match(stoppedAt(STEPS.run(CTX(), w.io), 'Switch on services'), /^Google said no \(400\): Request contains an invalid argument/);
});

test('the service that switches services on is itself off in that project: shows Google\'s own words, not "unknown project" and not "wait"', () => {
  const w = world(); w.failAt = ':enable$'; w.failCode = 403;
  google.broken = 'Service Usage API has not been used in project 123 before or it is disabled. Enable it by visiting the console.';
  const words = stoppedAt(STEPS.run(CTX(), w.io), 'Switch on services');
  google.broken = null;
  assert.strictEqual(words, 'Google said no (403): Service Usage API has not been used in project 123 before or it is disabled. Enable it by visiting the console.');
});

test('any other refusal when switching on: Google\'s code and words are shown', () => {
  const w = world(); w.failAt = ':enable$'; w.failCode = 429;
  assert.strictEqual(stoppedAt(STEPS.run(CTX(), w.io), 'Switch on services'), 'Google said no (429): broken');
});

// 18 Nov evening, the cold test: Google wanted the terms for SCRIPTS, and our words sent him to the Cloud terms page
// ("already accepted"). The address now comes out of Google's own answer, so it is always the page Google means.
test('Google wants its terms accepted first: the words give the address Google itself named', () => {
  const w = world(); w.terms = true;
  const words = stoppedAt(STEPS.run(CTX(), w.io), 'Switch on services');
  assert.strictEqual(words, 'Google needs you to accept its terms once. Open https://console.developers.google.com/terms/script, click Accept if Google shows the button, then run Set up again.');
  const w2 = world(); w2.terms = 'The terms of service cloud for serviceusage.googleapis.com must be accepted. Please visit https://console.developers.google.com/terms/cloud';
  assert.match(stoppedAt(STEPS.run(CTX(), w2.io), 'Switch on services'), /Open https:\/\/console\.developers\.google\.com\/terms\/cloud, click Accept/);
  const w3 = world(); w3.terms = 'The terms of service must be accepted.';
  assert.match(stoppedAt(STEPS.run(CTX(), w3.io), 'Switch on services'), /Open https:\/\/console\.developers\.google\.com\/terms\/script, click Accept/, 'no address from Google: the script terms page');
  const w4 = world(); w4.terms = 'The terms of service must be accepted. Visit https://console.developers.google.com/terms/other.';
  assert.match(stoppedAt(STEPS.run(CTX(), w4.io), 'Switch on services'), /Open https:\/\/console\.developers\.google\.com\/terms\/other, click Accept/, 'the full stop after the address is not part of it');
});

test('the switch is off but Google only says so when the script tries to publish (seen live 18 Nov): same plain words, switch shows Off', () => {
  const w = world(); w.switchOffForWrites = true;
  const facts = STEPS.run(CTX(), w.io);
  assert.strictEqual(stoppedAt(facts, 'Publish as a web app'), SWITCH_OFF);
  assert.strictEqual(facts.apiSwitch, false);
  w.switchOffForWrites = false;
  const again = STEPS.run(CTX(), w.io);
  assert.ok(okAll(again)); assert.strictEqual(again.apiSwitch, true);
});

test('switching a service on can take a while: it waits and asks again, 5 seconds at a time', () => {
  const w = world(); w.opPolls = 3;
  assert.ok(okAll(STEPS.run(CTX(), w.io)));
  assert.strictEqual(did(w, 'get', 'serviceusage.googleapis.com/v1/operations/'), 3);
  assert.ok(w.slept >= 15000);
});

test('a service that is still not on after a minute: step 1 fails and says to wait', () => {
  const w = world(); w.opPolls = 1000;
  const words = stoppedAt(STEPS.run(CTX(), w.io), 'Switch on services');
  assert.strictEqual(words, 'Google is still switching the services on. Wait a minute, then run Set up again.');
  assert.strictEqual(w.slept, 60000);
});

test('the "Google Apps Script API" switch is off: step 2 fails, the switch shows Off, and the words say what to do', () => {
  const w = world(); w.switchOff = true;
  const facts = STEPS.run(CTX(), w.io);
  const words = stoppedAt(facts, 'Publish as a web app');
  assert.strictEqual(facts.apiSwitch, false);
  assert.strictEqual(words, SWITCH_OFF);
  assert.strictEqual(did(w, 'post', '/versions'), 0);
  // ...and once it is on, the next run carries on from there without redoing step 1
  w.switchOff = false; w.calls.length = 0;
  const again = STEPS.run(CTX(), w.io);
  assert.ok(okAll(again));
  assert.strictEqual(again.apiSwitch, true);
  assert.strictEqual(did(w, 'post', ':enable'), 0);
});

test('the Apps Script service is only just switched on and not ready yet: says to wait, and does not blame the switch', () => {
  const w = world(); w.apiNotReady = true;
  const facts = STEPS.run(CTX(), w.io);
  assert.strictEqual(stoppedAt(facts, 'Publish as a web app'), 'Google is still switching the services on. Wait a minute, then run Set up again.');
  assert.strictEqual(facts.apiSwitch, undefined);
});

test('published but Google gives no web app address: step 2 fails and nothing is remembered as published', () => {
  const w = world(); w.noWebApp = true;
  const words = stoppedAt(STEPS.run(CTX(), w.io), 'Publish as a web app');
  assert.match(words, /no web app address/);
  assert.strictEqual(w.props.PFS_DEPLOYMENT, undefined);
  assert.strictEqual(w.props.PFS_WEBAPP, undefined);
});

test('newer code (a different version): a new version is published into the SAME web app, so the address stays', () => {
  const w = world();
  STEPS.run(CTX(), w.io);
  w.calls.length = 0;
  const ctx = CTX(); ctx.version = '1.1';
  assert.ok(okAll(STEPS.run(ctx, w.io)));
  assert.strictEqual(did(w, 'post', 'script.googleapis.com/v1/projects/SCRIPT-ONE/versions'), 1);
  assert.strictEqual(did(w, 'put', '/deployments/DEP1'), 1);
  assert.strictEqual(did(w, 'post', '/deployments'), 0);
  const put = w.calls.filter((c) => c.method === 'put')[0].body;
  assert.deepStrictEqual(put, { deploymentConfig: { versionNumber: put.deploymentConfig.versionNumber, manifestFileName: 'appsscript', description: 'Push from sheet 1.1', scriptId: 'SCRIPT-ONE' } });
  assert.strictEqual(w.props.PFS_WEBAPP, 'https://script.google.com/macros/s/DEP1/exec');
  assert.strictEqual(w.props.PFS_DEPLOYED, '1.1');
  assert.strictEqual(did(w, 'post', '/releases'), 0, 'the page did not change, so it is not uploaded again');
});

test('the web app was deleted by hand: a new one is made and the page is uploaded again with the new address', () => {
  const w = world();
  STEPS.run(CTX(), w.io);
  w.deploymentGone = true; w.calls.length = 0;
  const ctx = CTX(); ctx.version = '1.1';
  assert.ok(okAll(STEPS.run(ctx, w.io)));
  assert.strictEqual(w.props.PFS_WEBAPP, 'https://script.google.com/macros/s/DEP2/exec');
  const CONFIG = new Function(w.live[w.props.PFS_SITE]['/config.js'].toString() + '; return CONFIG;')();
  assert.strictEqual(CONFIG.script, 'https://script.google.com/macros/s/DEP2/exec');
});

test('the key is made once and never changed by a later run', () => {
  const w = world();
  STEPS.run(CTX(), w.io);
  const key = w.props.PFS_SENDING_KEY;
  STEPS.run(CTX(), w.io); STEPS.run(CTX(), w.io);
  assert.strictEqual(w.props.PFS_SENDING_KEY, key);
});

test('a random number that cannot be a key is refused: step 3 fails and no key is saved', () => {
  const w = world(); w.badRandom = true;
  stoppedAt(STEPS.run(CTX(), w.io), 'Make the keys');
  assert.strictEqual(w.props.PFS_SENDING_KEY, undefined);
});

test('Google refuses a page address twice (taken or not allowed): it tries another, up to three times', () => {
  const w = world(); w.refuseSites = 2;
  assert.ok(okAll(STEPS.run(CTX(), w.io)));
  const tried = w.calls.filter((c) => c.method === 'post' && c.url.indexOf('/sites?siteId=') > 0).map((c) => c.url.split('siteId=')[1]);
  assert.strictEqual(tried.length, 3);
  assert.strictEqual(new Set(tried).size, 3, 'a different address each time');
  assert.strictEqual(w.props.PFS_SITE, tried[2]);
});

test('three refusals in a row: step 4 fails and shows what Google said', () => {
  const w = world(); w.refuseSites = 3;
  const words = stoppedAt(STEPS.run(CTX(), w.io), 'Make the page site');
  assert.match(words, /^Google would not give this sheet a page address after 3 tries\. It said: Invalid name/);
  assert.strictEqual(w.props.PFS_SITE, undefined);
});

test('"somebody else has that address" (code 409) is also a reason to try another', () => {
  const w = world(); w.refuseSites = 1; w.refuseCode = 409;
  assert.ok(okAll(STEPS.run(CTX(), w.io)));
  assert.strictEqual(did(w, 'post', '/sites?siteId='), 2);
});

test('looking for the remembered site fails for some other reason: step 4 stops and the site is NOT thrown away', () => {
  const w = world();
  STEPS.run(CTX(), w.io);
  const site = w.props.PFS_SITE, page = w.props.PFS_PAGE;
  w.failAt = '^get .*/sites/';
  assert.strictEqual(stoppedAt(STEPS.run(CTX(), w.io), 'Make the page site'), 'Google said no (500): broken');
  assert.strictEqual(w.props.PFS_SITE, site);
  assert.strictEqual(w.props.PFS_PAGE, page);
  assert.strictEqual(did(w, 'post', '/sites?siteId='), 1, 'no second site was made');
});

test('a new site means the old page address is forgotten at once, even if the upload then fails', () => {
  const w = world();
  STEPS.run(CTX(), w.io);
  delete w.sites[w.props.PFS_SITE];
  w.releaseFails = true;
  stoppedAt(STEPS.run(CTX(), w.io), 'Upload the sign-up page');
  assert.strictEqual(w.props.PFS_PAGE, undefined, 'the sender must not link to a page that is gone');
});

test('each call of the upload is checked: a refusal at any of them stops step 5 there', () => {
  [['^post .*/sites/[^/]+/versions$', 0], [':populateFiles$', 0], ['update_mask=status$', 7]].forEach(function (c) {
    const w = world(); w.failAt = c[0];
    assert.strictEqual(stoppedAt(STEPS.run(CTX(), w.io), 'Upload the sign-up page'), 'Google said no (500): broken', c[0]);
    assert.strictEqual(did(w, 'post', 'upload-firebasehosting'), c[1], 'uploads before the refusal at ' + c[0]);
    assert.strictEqual(did(w, 'post', '/releases'), 0, 'nothing released after a refusal at ' + c[0]);
    assert.strictEqual(w.props.PFS_PAGE, undefined);
  });
});

test('each call of the publish is checked too', () => {
  [['^post .*/versions$', 0], ['^post .*/deployments$', 1]].forEach(function (c) {
    const w = world(); w.failAt = c[0].replace('^post ', '^post https://script.googleapis.com');
    assert.strictEqual(stoppedAt(STEPS.run(CTX(), w.io), 'Publish as a web app'), 'Google said no (500): broken', c[0]);
    assert.strictEqual(w.props.PFS_WEBAPP, undefined);
  });
  const w = world(); STEPS.run(CTX(), w.io);
  w.failAt = '^put '; const ctx = CTX(); ctx.version = '1.1';
  assert.strictEqual(stoppedAt(STEPS.run(ctx, w.io), 'Publish as a web app'), 'Google said no (500): broken');
  assert.strictEqual(w.props.PFS_DEPLOYED, '1.0', 'still remembered as the old version, so the next run tries again');
});

test('any other answer when making the site stops at once, with no second try', () => {
  const w = world(); w.sitesBroken = true;
  const words = stoppedAt(STEPS.run(CTX(), w.io), 'Make the page site');
  assert.strictEqual(words, 'Google said no (500): Internal error');
  assert.strictEqual(did(w, 'post', '/sites?siteId='), 1);
});

test('the remembered site is gone from Google: a new one is made and the page goes up on it', () => {
  const w = world();
  STEPS.run(CTX(), w.io);
  const old = w.props.PFS_SITE;
  delete w.sites[old];
  assert.ok(okAll(STEPS.run(CTX(), w.io)));
  assert.notStrictEqual(w.props.PFS_SITE, old);
  assert.ok(w.live[w.props.PFS_SITE]['/index.html']);
  assert.strictEqual(w.shown.url, 'https://' + w.props.PFS_SITE + '.web.app/');
});

test('upload: only the files Google says it is missing are sent, each under the name Google asked for', () => {
  const w = world();
  STEPS.run(CTX(), w.io);
  assert.strictEqual(did(w, 'post', 'upload-firebasehosting.googleapis.com'), 7);
  w.calls.length = 0;
  const ctx = CTX(); ctx.files['index.html'] = '<!doctype html><title>page two</title>';
  assert.ok(okAll(STEPS.run(ctx, w.io)));
  assert.strictEqual(did(w, 'post', 'upload-firebasehosting.googleapis.com'), 1, 'only the changed file');
  assert.strictEqual(w.live[w.props.PFS_SITE]['/index.html'].toString(), '<!doctype html><title>page two</title>');
  assert.strictEqual(w.live[w.props.PFS_SITE]['/sw.js'].toString(), '// worker', 'unchanged files are still in the new release');
});

test('a packer that gives different bytes each time for the same file (a time inside the gzip) does not cause a new upload', () => {
  const w = world(); w.gzipWobbles = 1;
  STEPS.run(CTX(), w.io);
  w.calls.length = 0;
  assert.ok(okAll(STEPS.run(CTX(), w.io)));
  assert.strictEqual(did(w, 'post', 'firebasehosting.googleapis.com'), 0);
});

test('a changed setting (colour) puts a new page up but does not publish the web app again', () => {
  const w = world();
  STEPS.run(CTX(), w.io);
  w.calls.length = 0;
  const ctx = CTX(); ctx.colour = '#C62828'; ctx.backupMinutes = 0;
  assert.ok(okAll(STEPS.run(ctx, w.io)));
  assert.strictEqual(w.watched, 0, 'the watcher gets the minutes from Setup (0 = no backup check)');
  assert.strictEqual(did(w, 'post', '/releases'), 1);
  assert.strictEqual(did(w, 'post', 'script.googleapis.com'), 0);
  assert.strictEqual(JSON.parse(w.live[w.props.PFS_SITE]['/manifest.json'].toString()).theme_color, '#C62828');
});

test('a failed upload or release: step 5 fails, and the next run tries the whole upload again', () => {
  const w = world(); w.releaseFails = true;
  const words = stoppedAt(STEPS.run(CTX(), w.io), 'Upload the sign-up page');
  assert.strictEqual(words, 'Google said no (500): backend error');
  assert.strictEqual(w.props.PFS_PAGE, undefined);
  w.releaseFails = false;
  assert.ok(okAll(STEPS.run(CTX(), w.io)));
  const w2 = world(); w2.uploadFails = true;
  assert.strictEqual(stoppedAt(STEPS.run(CTX(), w2.io), 'Upload the sign-up page'), 'Google said no (503): try later');
  assert.strictEqual(did(w2, 'post', '/releases'), 0, 'nothing is released after a failed upload');
});

test('the watcher cannot be turned on: step 6 fails with the reason, and the link is not shown yet', () => {
  const w = world(); w.watchFails = 'This script has too many triggers';
  const facts = STEPS.run(CTX(), w.io);
  assert.strictEqual(stoppedAt(facts, 'Turn on the watcher'), 'The watcher could not be turned on: This script has too many triggers');
  assert.strictEqual(w.shown, null);
  assert.strictEqual(facts.page, undefined);
});

test('something unexpected (a web call that blows up): the step fails in plain words instead of crashing Set up', () => {
  const w = world(); w.callThrows = 'DNS error';
  const facts = STEPS.run(CTX(), w.io);
  assert.strictEqual(stoppedAt(facts, 'Switch on services'), 'Something unexpected stopped this step: DNS error');
  assert.deepStrictEqual(STEPS.facts(w.io).steps, facts.steps, 'still remembered for the ticks');
});

test('a COPY of a set-up sheet starts fresh: the first sheet\'s keys, devices, site and web app are not carried over', () => {
  const w = world();
  STEPS.run(CTX(), w.io);
  const first = Object.assign({}, w.props);
  w.props['phone_' + 'a'.repeat(32)] = '{"name":"Sam"}';
  w.props['run-sending-123'] = '1';
  w.props.SOMETHING_ELSE = 'kept';
  w.id = 'SCRIPT-TWO'; w.calls.length = 0;
  const facts = STEPS.run(CTX(), w.io);
  assert.ok(okAll(facts));
  assert.strictEqual(facts.fresh, true);
  assert.strictEqual(w.wiped, 1, 'the Devices tab is emptied');
  assert.strictEqual(w.props['phone_' + 'a'.repeat(32)], undefined);
  assert.strictEqual(w.props['run-sending-123'], undefined);
  assert.strictEqual(w.props.SOMETHING_ELSE, 'kept', 'only our own entries are cleared');
  assert.notStrictEqual(w.props.PFS_SENDING_KEY, first.PFS_SENDING_KEY);
  assert.notStrictEqual(w.props.PFS_SITE, first.PFS_SITE);
  assert.strictEqual(w.props.PFS_WEBAPP, 'https://script.google.com/macros/s/DEP2/exec');
  assert.strictEqual(w.props.PFS_SCRIPT_ID, 'SCRIPT-TWO');
  assert.strictEqual(did(w, 'post', ':enable'), 2, 'services are checked again for the copy');
});

test('isCopy tells the menu before anything is sent: true only when the remembered script is a different one', () => {
  const w = world();
  assert.strictEqual(STEPS.isCopy(w.io), false, 'never set up');
  STEPS.run(CTX(), w.io);
  assert.strictEqual(STEPS.isCopy(w.io), false);
  w.id = 'SCRIPT-TWO';
  assert.strictEqual(STEPS.isCopy(w.io), true);
});

test('the same sheet, set up twice, is never treated as a copy', () => {
  const w = world();
  STEPS.run(CTX(), w.io);
  const key = w.props.PFS_SENDING_KEY;
  const facts = STEPS.run(CTX(), w.io);
  assert.strictEqual(facts.fresh, false);
  assert.strictEqual(w.wiped, 0);
  assert.strictEqual(w.props.PFS_SENDING_KEY, key);
});

test('a different Firebase project typed later: services are switched on in the new one', () => {
  const w = world();
  STEPS.run(CTX(), w.io);
  w.calls.length = 0;
  const ctx = CTX(); ctx.project = 'other-project';
  STEPS.run(ctx, w.io);
  assert.strictEqual(did(w, 'post', 'projects/other-project/services/'), 2);
  assert.strictEqual(w.props.PFS_PROJECT, 'other-project');
});

test('the page address is made from the app name: small letters, digits and dashes, a letter first, 27 at most', () => {
  assert.strictEqual(STEPS.siteId('Smith Cutting – Push!', 'abc123'), 'smith-cutting-push-abc123');
  assert.strictEqual(STEPS.siteId('24/7 Jobs', 'abc123'), 'push-24-7-jobs-abc123');
  assert.strictEqual(STEPS.siteId('', 'abc123'), 'push-abc123');
  assert.strictEqual(STEPS.siteId('éè', 'abc123'), 'push-abc123');
  const long = STEPS.siteId('A very long company name indeed and more', 'abc123');
  assert.strictEqual(long, 'a-very-long-company-abc123');
  assert.ok(long.length <= 27);
  assert.match(STEPS.siteId('ends with dash at cut--x', 'abc123'), /^[a-z][a-z0-9-]*[a-z0-9]$/);
  assert.ok(STEPS.siteId('a--b', 'abc123').indexOf('--') < 0);
});

test('page files: the manifest carries the owner\'s name and colour, and a name with quotes cannot break config.js', () => {
  const ctx = CTX(); ctx.appName = 'Bob\'s "Best" Cutting </script>';
  const files = STEPS.pageFiles(ctx, { script: 'https://script.google.com/macros/s/X/exec', publicKey: 'BKEY' });
  const man = JSON.parse(files['manifest.json']);
  assert.strictEqual(man.name, ctx.appName);
  assert.strictEqual(man.short_name, ctx.appName, 'the whole name: the phone shortens it itself (18 Nov: cut at 12 it read "Push from sh" on the iPhone)');
  assert.strictEqual(man.theme_color, '#2E7D32');
  assert.strictEqual(man.display, 'standalone');
  assert.deepStrictEqual(man.icons.map((i) => i.src + ' ' + i.sizes), ['icon-192.png 192x192', 'icon-512.png 512x512']);
  const CONFIG = new Function(files['config.js'] + '; return CONFIG;')();
  assert.strictEqual(CONFIG.name, ctx.appName);
  assert.ok(files['config.js'].indexOf('</script>') < 0, 'cannot close a script tag early');
});

test('page files: three icons in the owner\'s colour with a white bell, at the sizes phones ask for', () => {
  const files = STEPS.pageFiles(CTX(), { script: 'https://x/exec', publicKey: 'BKEY' });
  [180, 192, 512].forEach(function (size) {
    const b = Buffer.from(files['icon-' + size + '.png']);
    assert.deepStrictEqual([b.readUInt32BE(16), b.readUInt32BE(20)], [size, size]);
    const plte = b.indexOf('PLTE'), len = b.readUInt32BE(plte - 4);
    assert.equal(len, 17 * 3, '17 shades from the owner colour to white');
    assert.deepEqual([...b.subarray(plte + 4, plte + 7)], [0x2E, 0x7D, 0x32], 'shade 0 = the owner colour');
    assert.deepEqual([...b.subarray(plte + 4 + 48, plte + 4 + 51)], [255, 255, 255], 'shade 16 = white');
  });
  const ctx = CTX(); ctx.colour = 'not a colour';
  const b = Buffer.from(STEPS.pageFiles(ctx, { script: 'https://x/exec', publicKey: 'BKEY' })['icon-180.png']);
  assert.deepStrictEqual([...b.subarray(b.indexOf('PLTE') + 4, b.indexOf('PLTE') + 7)], PNG.rgb(SETUP.DEFAULT_COLOUR), 'a colour that cannot be read falls back to the default');
});

test('the icon picture: a bell in the middle, smooth edges (shades 1-15), clear of the edges, the same left and right', () => {
  const g = STEPS.icon(64);
  assert.strictEqual(g.length, 64);
  assert.strictEqual(g[32][32], 16, 'the middle is solid bell');
  assert.deepEqual([g[12][32] > 8, g[48][32] > 8, g[53][32]], [true, true, 0], 'the loop on top, the clapper, and clear below it');
  let on = 0, shaded = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const v = g[y][x];
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 16, 'shade ' + v);
    on += v / 16; if (v > 0 && v < 16) shaded++;
    assert.strictEqual(v, g[y][63 - x], 'mirror at ' + x + ',' + y);
    if (x < 10 || x > 53 || y < 10 || y > 53) assert.strictEqual(v, 0, 'edge clear at ' + x + ',' + y);
  }
  assert.ok(on > 64 * 64 * 0.08 && on < 64 * 64 * 0.3, 'the bell covers ' + on + ' of 4096');
  assert.ok(shaded > 60, 'the edges are shaded (' + shaded + ' cells)');
});

test('what the last run found can be read back later; nothing or rubbish stored reads as "nothing done yet"', () => {
  const w = world();
  assert.deepStrictEqual(STEPS.facts(w.io), { steps: {} });
  w.props.PFS_FACTS = '{not json';
  assert.deepStrictEqual(STEPS.facts(w.io), { steps: {} });
  w.props.PFS_FACTS = 'null';
  assert.deepStrictEqual(STEPS.facts(w.io), { steps: {} });
});

test('summary: what Set up tells the owner at the end', () => {
  const w = world(), facts = STEPS.run(CTX(), w.io);
  assert.strictEqual(STEPS.summary(facts), 'All done. Open the sign-up page on each phone or computer and turn on notifications.');
  const w2 = world(); w2.switchOff = true;
  assert.strictEqual(STEPS.summary(STEPS.run(CTX(), w2.io)), 'Stopped at step 2 of 7 (Publish as a web app). ' + SWITCH_OFF);
  const w3 = world(); STEPS.run(CTX(), w3.io); w3.id = 'SCRIPT-TWO';
  assert.match(STEPS.summary(STEPS.run(CTX(), w3.io)), /^This sheet is a copy, so it started fresh with its own page and no devices\. All done\./);
  assert.strictEqual(STEPS.summary({ steps: {} }), 'Set up has not finished. Run Set up again.');
});

// ---- cold test 2, 18 Nov 9pm ----
test('project unknown: the words point at the Firebase project address row and say to paste the address', () => {
  const w = world(); w.unknownProject = true;
  assert.strictEqual(stoppedAt(STEPS.run(CTX(), w.io), 'Switch on services'),
    'Google does not know a Firebase project called "smith-cutting-push" on this Google account. Open your project in Firebase, copy the address from the address bar and paste it into "Firebase project address" on Setup.');
});

test('terms: the words say to click Accept if Google shows the button (a new account gets one), never "opening the page is enough"', () => {
  const w = world(); w.terms = true;
  const words = stoppedAt(STEPS.run(CTX(), w.io), 'Switch on services');
  assert.strictEqual(words, 'Google needs you to accept its terms once. Open https://console.developers.google.com/terms/script, click Accept if Google shows the button, then run Set up again.');
});

test('finished: true only when every step is done and there is a page; the summary then is short, because the share box shows the page', () => {
  const done = { steps: {}, page: 'https://x.web.app/' };
  NAMES.forEach(n => { done.steps[n] = { ok: true }; });
  assert.strictEqual(STEPS.finished(done), true);
  assert.strictEqual(STEPS.summary(done), 'All done. Open the sign-up page on each phone or computer and turn on notifications.');
  assert.strictEqual(STEPS.finished(Object.assign({}, done, { page: '' })), false);
  const failed = { steps: Object.assign({}, done.steps, { 'Make the keys': { error: 'no' } }), page: 'https://x.web.app/' };
  assert.strictEqual(STEPS.finished(failed), false);
});
