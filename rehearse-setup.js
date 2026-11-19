// Offline rehearsal of the Devices switch: a pretend sheet that keeps values and treats every formatting call as done.
const fs = require('fs'), crypto = require('crypto'), vm = require('vm');
const SRC = fs.readFileSync(process.argv[2], 'utf8');
const props = {}, logs = [], fetched = [], triggers = [];
function phone(prefix) {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const id = prefix + '0'.repeat(28);
  props['phone_' + id] = JSON.stringify({ endpoint: 'https://web.push.apple.com/' + prefix, added: 1700000000000, lastSend: 0, lastCode: 0, approved: true, listed: true,
    p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') });
  return id;
}
const ids = [];
const k = crypto.createECDH('prime256v1'); k.generateKeys(); 
const any = () => new Proxy(function () {}, { get: (t, p) => p === 'build' ? () => ({}) : any(), apply: () => any() });
function makeSheet(name, grid) {
  const s = { name, grid, maxRows: Math.max(1000, grid.length), maxCols: 26 };
  const cell = (r, c) => ((s.grid[r - 1] || [])[c - 1]);
  const range = (r, c, nr, nc) => { nr = nr || 1; nc = nc || 1; const rg = new Proxy({}, { get: (t, p) => {
    if (p === 'setValue') return (v) => { if (G.watch && v === G.watch) G.heldAtMark = G.lockHeld === true; while (s.grid.length < r) s.grid.push([]); s.grid[r - 1][c - 1] = v; return rg; };
    if (p === 'setValues') return (vals) => { if (vals.length !== nr || vals.some(x => x.length !== nc)) throw new Error('setValues size ' + vals.length + 'x' + (vals[0] || []).length + ' into ' + nr + 'x' + nc);
      for (let i = 0; i < nr; i++) { while (s.grid.length < r + i) s.grid.push([]); for (let j = 0; j < nc; j++) s.grid[r - 1 + i][c - 1 + j] = vals[i][j]; } return rg; };
    if (p === 'getValues' || p === 'getDisplayValues') return () => { const out = Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = cell(r + i, c + j); return v === undefined ? '' : (p === 'getDisplayValues' ? String(v) : v); }));
      if (name === 'Setup' && p === 'getDisplayValues') { G.reads = (G.reads || 0) + 1; if (G.traceReads) G.traceReads.push(new Error().stack.split('\n').slice(2, 4).map(x => x.trim().split(' ')[1]).join('<')); }
      if (name === 'Setup' && G.afterRead && --G.afterRead.n <= 0) { const f = G.afterRead.f; G.afterRead = null; f(); }   // the owner types just after Set up read the tab
      return out; };
    if (p === 'clearContent') return () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (s.grid[r - 1 + i]) s.grid[r - 1 + i][c - 1 + j] = ''; return rg; };
    return () => rg; } }); return rg; };
  const proxy = new Proxy(s, { get: (t, p) => {
    if (p === 'grid') return s.grid;
    if (p === 'getName') return () => name;
    if (p === 'getTabColor') return () => s.tab || null;
    if (p === 'setTabColor') return (c) => { s.tab = c; return proxy; };
    if (p === 'getSheetId') return () => s.id || (s.id = 1000 + Object.keys(sheets).indexOf(name));
    if (p === 'setName') return (n) => { delete sheets[name]; sheets[n] = proxy; name = n; };
    if (p === 'getRange') return (a, b, c2, d) => typeof a === 'string' ? range(1, 1) : range(a, b, c2, d);
    if (p === 'getLastRow') return () => { for (let i = s.grid.length; i > 0; i--) if ((s.grid[i - 1] || []).some(v => v !== '' && v !== undefined && v !== null)) return i; return 0; };
    if (p === 'getLastColumn') return () => Math.max(0, ...s.grid.map(r => r.length));
    if (p === 'getMaxRows') return () => s.maxRows;
    if (p === 'getMaxColumns') return () => s.maxCols;
    if (p === 'deleteRows') return (from, n) => { s.maxRows -= n; s.grid.length = Math.min(s.grid.length, s.maxRows); };
    if (p === 'insertRowsAfter') return (after, n) => { s.maxRows += n; };
    if (p === 'deleteColumns') return (from, n) => { s.maxCols -= n; };
    if (p === 'getDataRange') return () => range(1, 1, Math.max(1, s.grid.length), Math.max(1, ...s.grid.map(r => r.length)));
    if (p === 'getRangeList') return () => any();
    if (p === 'getDeveloperMetadata') return () => (s.meta || []).map(m => ({ getKey: () => m.k, getValue: () => m.v, remove: () => { s.meta = s.meta.filter(x => x !== m); } }));
    if (p === 'addDeveloperMetadata') return (k, v) => { (s.meta = s.meta || []).push({ k, v }); };
    return () => any(); } });
  return proxy;
}
const setupGrid = [[], ['', 'Job Sheet test'], [], ['', 'Firebase project ID', 'sheet-push-host-test'], ['', 'App name', 'Job Sheet test'], ['', 'Colour', '#1565C0'],
  ['', 'Icon', 'Plain default'], ['', 'Tab with your rows', 'Jobs'], ['', 'Title column', 'Job Type'], ['', 'Message column', 'Customer, Address'],
  ['', 'Push To column', 'Push To'], ['', 'Link to open', ''], ['', 'Sign-ups', 'Approve'], ['', 'Backup check', '10 minutes']];
setupGrid.splice(3, 1, ['', 'Firebase project name', 'Smith Cutting Push']);
setupGrid[8] = ['', 'Title column', 'Title']; setupGrid[9] = ['', 'Message column', 'Details, Address'];
const HEADER = ['Name', 'Email', 'Device', 'Let in', 'Signed up', 'Last seen', 'Last message', 'Status', 'ID'];
const sheets = { Jobs: makeSheet('Jobs', [['Title', 'Details', 'Address', 'Push To'], ['Core drilling', '2 holes 150mm', '12 Smith St', '']]) };
sheets.Setup = makeSheet('Setup', [[], ['', 'Smith Cutting'], ['', 'Push from sheet  ·  free push notifications to phones and computers']].concat(setupGrid.slice(3)));
const book = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = makeSheet(n, [])), getName: () => 'Push from sheet', getSheets: () => Object.values(sheets), getId: () => G.bookId || 'BOOK-ONE',
  getSpreadsheetTimeZone: () => G.zone || 'Australia/Sydney', getOwner: () => (G.owner === undefined ? { getEmail: () => 'owner@example.com' } : G.owner) };
let trig = ['runOnChange', 'runTimer', 'someoneElsesScript'].map(f => ({ f, getHandlerFunction: () => f }));
const ctx = {
  console, JSON, Math, Date, String, Array, Object, Number, RegExp, Error, parseInt, isFinite, BigInt,
  Logger: { log: (s) => logs.push(String(s)) },
  HtmlService: { createHtmlOutput: (h) => { const o = { getContent: () => h, setWidth: () => o, setHeight: () => o }; return o; } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; }, getKeys: () => Object.keys(props) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => (G.lockHeld = true), waitLock: () => { G.lockHeld = true; }, releaseLock: () => { G.lockHeld = false; } }) },
  SpreadsheetApp: { openById: () => book, getActiveSpreadsheet: () => book, getUi: () => { throw new Error('no ui'); }, flush: () => {}, BorderStyle: { SOLID: 'SOLID', SOLID_THICK: 'SOLID_THICK' }, ProtectionType: { RANGE: 'RANGE' }, newConditionalFormatRule: any, newDataValidation: any, newRichTextValue: any, newTextStyle: any },
  Session: { getScriptTimeZone: () => 'Australia/Sydney' },
  ScriptApp: { getProjectTriggers: () => trig.slice(), deleteTrigger: (t) => { trig = trig.filter(x => x !== t); }, newTrigger: (f) => any() },
  Utilities: { base64Encode: (b) => Buffer.from(b.map(x => x & 255)).toString("base64"),
    formatDate: (d, tz, f) => { G.zoneUsed = tz; return f.indexOf('s') >= 0 ? '1:05:00 PM' : '18 Nov 1:05 PM'; }, getUuid: () => crypto.randomUUID(), sleep: (ms) => { G.slept = (G.slept || 0) + ms; if (G.onSleep) G.onSleep(); },
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(Buffer.from(typeof s === 'string' ? s : Buffer.from(s.map(b => b & 255)))).digest()).map(b => b > 127 ? b - 256 : b),
    computeHmacSha256Signature: (v, key) => Array.from(crypto.createHmac('sha256', Buffer.from(key.map(b => b & 255))).update(Buffer.from(v.map(b => b & 255))).digest()).map(b => b > 127 ? b - 256 : b),
    base64EncodeWebSafe: (b) => Buffer.from(typeof b === 'string' ? b : b.map(x => x & 255)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64DecodeWebSafe: (s) => Array.from(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')).map(b => b > 127 ? b - 256 : b),
    newBlob: (s) => ({ getBytes: () => Array.from(Buffer.from(s, 'utf8')).map(b => b > 127 ? b - 256 : b) })
  },
  UrlFetchApp: { fetch: (url, o) => { if (url.indexOf('raw.githubusercontent') >= 0) return { getResponseCode: () => 404, getContentText: () => '404: Not Found' }; fetched.push(url); return { getResponseCode: () => 201 }; } }
};

// ---- 18 Nov: the Firebase steps, against a pretend Google that answers the way the real one did on 17-18 Nov ----
const zlib = require('zlib');
const G = { sites: {}, stored: {}, live: {}, version: 0, deps: 0, calls: [], switchOff: false };
const un = (b) => Buffer.from(b.map(x => x & 255)), sg = (buf) => Array.from(buf).map(b => b > 127 ? b - 256 : b);
ctx.Utilities.newBlob = (data, type, name) => ({ getBytes: () => typeof data === 'string' ? sg(Buffer.from(data, 'utf8')) : data.slice(), type, name });
ctx.Utilities.gzip = (blob) => ({ getBytes: () => sg(zlib.gzipSync(un(blob.getBytes()))) });
ctx.ScriptApp.AuthMode = { FULL: 'FULL' }; ctx.ScriptApp.requireAllScopes = (m) => { G.asked = (G.asked || 0) + (m === 'FULL' ? 1 : 0); };
ctx.ScriptApp.getOAuthToken = () => 'TOKEN'; ctx.ScriptApp.getScriptId = () => G.scriptId || 'SCRIPT-ONE';
book.deleteSheet = (sh) => { delete sheets[sh.getName()]; }; book.toast = () => {};
book.setActiveSheet = (sh) => { book._active = sh; }; book.moveActiveSheet = (pos) => { const n = book._active.getName(), list = Object.keys(sheets).filter(k => k !== n); list.splice(pos - 1, 0, n); const copy = {}; list.forEach(k => { copy[k] = sheets[k]; }); Object.keys(sheets).forEach(k => delete sheets[k]); Object.assign(sheets, copy); };
const reply = (code, json) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(json) });
ctx.UrlFetchApp.fetch = (url, o) => {
  o = o || {};
  if (G.onFetch) { const f = G.onFetch; G.onFetch = null; f(); }   // the owner types while Set up is running
  if (url.indexOf('raw.githubusercontent') >= 0) return { getResponseCode: () => 404, getContentText: () => '404: Not Found' };
  if (url.indexOf('googleapis.com') < 0) { fetched.push(url); return { getResponseCode: () => 201, getContentText: () => '' }; }
  const m = o.method, H = 'https://firebasehosting.googleapis.com/v1beta1/';
  if (o.headers.Authorization !== 'Bearer TOKEN' || !o.headers['x-goog-user-project']) throw new Error('call without sign-in or project: ' + url);
  G.calls.push(m + ' ' + url.replace('https://', '').split('?')[0].slice(0, 80));
  let x;
  if (/:enable$/.test(url)) return reply(200, { name: 'operations/op1', done: true });
  if (url === 'https://script.googleapis.com/v1/projects/' + ctx.ScriptApp.getScriptId()) return G.switchOff ? reply(403, { error: { message: 'User has not enabled the Apps Script API. Enable it by visiting https://script.google.com/home/usersettings then retry.' } }) : reply(200, {});
  if (/\/versions$/.test(url) && url.indexOf('script.googleapis') > 0) return reply(200, { versionNumber: ++G.version });
  const web = (id) => ({ deploymentId: id, entryPoints: [{ entryPointType: 'WEB_APP', webApp: { url: 'https://script.google.com/macros/s/' + id + '/exec' } }] });
  if (/\/deployments$/.test(url)) return reply(200, web('DEP' + (++G.deps)));
  if ((x = /\/deployments\/(\w+)$/.exec(url))) return reply(200, web(x[1]));
  if ((x = /\/sites\/([^/?]+)$/.exec(url)) && m === 'get') return G.sites[x[1]] ? reply(200, {}) : reply(404, { error: { message: 'not found' } });
  if ((x = /\/sites\?siteId=(.+)$/.exec(url))) { G.sites[x[1]] = true; return reply(200, { name: 'sites/' + x[1] }); }
  if ((x = /sites\/([^/]+)\/versions$/.exec(url))) return reply(200, { name: 'sites/' + x[1] + '/versions/v' + (++G.version) });
  if (/:populateFiles$/.test(url)) { G.listed = JSON.parse(o.payload).files; return reply(200, { uploadRequiredHashes: Object.values(G.listed).filter(h => !(h in G.stored)), uploadUrl: 'https://upload-firebasehosting.googleapis.com/upload/x/files' }); }
  if (url.indexOf('https://upload-firebasehosting.googleapis.com/') === 0) {
    const h = url.split('/').pop(), bytes = un(o.payload);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== h) throw new Error('uploaded bytes do not match their name');
    G.stored[h] = bytes; return reply(200, {});
  }
  if (/update_mask=status$/.test(url)) return reply(200, {});
  if ((x = /sites\/([^/]+)\/releases\?/.exec(url))) { G.live[x[1]] = {}; Object.keys(G.listed).forEach(p => { G.live[x[1]][p] = zlib.gunzipSync(G.stored[G.listed[p]]); }); return reply(200, {}); }
  throw new Error('pretend Google has no answer for ' + m + ' ' + url);
};
vm.createContext(ctx); vm.runInContext(SRC, ctx);
const run = (f) => { logs.length = 0; vm.runInContext(f + '()', ctx); console.log('--- ' + f + '\n' + logs.join('\n')); };


const safe = (f) => { try { run(f); } catch (e) { console.log('--- ' + f + ' STOPPED: ' + e.stack.split('\n').slice(0, 4).join(' | ')); } };
const val = (label, col) => (sheets.Setup.grid.find(r => r[1] === label) || [])[col || 2];
const ticks = () => console.log('ticks:', ['Switch on services', 'Publish as a web app', 'Make the keys', 'Make the page site', 'Upload the sign-up page', 'Turn on the watcher', 'Page link and QR code'].map(n => val(n)).join(' | '), '\nheads:', JSON.stringify(sheets.Setup.grid[5]), '\nswitch:', val('"Google Apps Script API" switch'), '| page row:', val('Sign-up page'));
console.log('===== 1. switch off');
G.switchOff = true; safe('pfsSetUp'); ticks(); console.log('reason beside the failed step:', val('Publish as a web app', 3));
console.log('===== 2. switch on: carries on');
G.switchOff = false; G.calls.length = 0; safe('pfsSetUp'); ticks();
console.log('calls:', G.calls.length, '| props:', Object.keys(props).filter(k => k.indexOf('PFS_') === 0).sort().join(','));
const site = props.PFS_SITE, live = G.live[site] || {};
console.log('site:', site, '| live files:', Object.keys(live).sort().join(' '));
console.log('config.js:', String(live['/config.js'] || '').split('\n')[1]);
console.log('manifest name/colour:', JSON.parse(String(live['/manifest.json'])).name, JSON.parse(String(live['/manifest.json'])).theme_color, '| icon-192 bytes:', (live['/icon-192.png'] || []).length, '| index bytes:', (live['/index.html'] || []).length);
console.log('===== 3. again, nothing changed');
G.calls.length = 0; safe('pfsSetUp'); console.log('calls:', G.calls.join(' ; '));
console.log('===== 4. send a test, then the same sheet as a COPY');
safe('pfsSendTest');
G.scriptId = 'SCRIPT-TWO'; safe('pfsSendTest'); G.calls.length = 0; safe('pfsSetUp'); ticks();
console.log('new site:', props.PFS_SITE, '(was ' + site + ') | tabs:', Object.keys(sheets).join(', '));

console.log('===== 5. owner renames Jobs to Bookings, then a row arrives');
G.scriptId = 'SCRIPT-TWO';
sheets.Jobs.setName('Bookings');
// The copy starts with no devices: a phone signs up, shows on Devices as waiting, and the owner ticks Let in.
{ const id = phone('C'), rec = JSON.parse(props['phone_' + id]); rec.approved = false; rec.listed = false; props['phone_' + id] = JSON.stringify(rec);
  safe('runOnChange');
  const d = sheets.Devices.grid, h = d.findIndex(r => r.indexOf('Let in') >= 0), li = d[h].indexOf('Let in');
  const row = d.find((r, i) => i > h && r.join('|').indexOf(id) >= 0);
  console.log('new phone on Devices:', !!row); if (row) row[li] = true; }   // the owner ticks Let in
sheets.Bookings.grid.push(['Renamed tab row', 'Core drill', '5 Rename St', '']);
fetched.length = 0;
safe('runOnChange');
console.log('Setup now says tab =', JSON.stringify(val('Tab with your rows')), '| sent pushes:', fetched.length, '| tabs:', Object.keys(sheets).join(', '));
console.log('the row now says:', JSON.stringify(sheets.Bookings.grid[sheets.Bookings.grid.length - 1][4]));
console.log('===== 6. AppSheet Yes: Set up puts their tab first');
const ar = sheets.Setup.grid.find(r => r[1] === 'Making an AppSheet app?'); if (ar) ar[2] = 'Yes';
safe('pfsSetUp');
console.log('tab order:', Object.keys(sheets).join(', '));
console.log('===== 7. owner renames the Title heading: Set up stops at "pick again", no Google calls');
sheets.Bookings.grid[0][0] = 'Job';
G.calls.length = 0; safe('pfsSetUp');
console.log('Google calls:', G.calls.length, '| Title column note:', JSON.stringify(val('Title column', 3)));
console.log('===== 8. the shared master: Set up refuses and says to make a copy, no Google calls');
sheets.Bookings.grid[0][0] = 'Title'; G.bookId = '1cEkCkMDHR85XqrXljxhCz8w_LEZTNxWlts5GbpybLyA';
G.calls.length = 0; safe('pfsSetUp'); console.log('Google calls:', G.calls.length);
console.log('owner named in the master\'s links:', JSON.stringify(vm.runInContext('pfsOwner_(pfsBook_())', ctx)), '(must be empty: the master is read and copied by strangers)');
console.log('===== 9. set up in its own sheet, then someone copies it and opens the copy');
G.bookId = undefined; safe('pfsSetUp');   // back in its own sheet (BOOK-ONE)
console.log('before the copy: heading', JSON.stringify(sheets.Setup.grid[1][4]), '| project', JSON.stringify(val('Firebase project address')), '| page', JSON.stringify(val('Sign-up page')));
vm.runInContext('function _openCopy() { pfsCopyCheck_(pfsBook_()); }', ctx);
G.bookId = 'BOOK-COPY'; G.scriptId = 'SCRIPT-COPY'; G.calls.length = 0; safe('_openCopy');   // a real copy: new sheet ID and new script ID
console.log('Devices tab in the copy lists the old phone:', sheets.Devices.grid.some(r => r.join('|').indexOf('C000') >= 0));
console.log('in the copy: heading', JSON.stringify(sheets.Setup.grid[1][4]), '| project', JSON.stringify(val('Firebase project address')), '| page', JSON.stringify(val('Sign-up page')), '| app name', JSON.stringify(val('App name')), '| Google calls:', G.calls.length);
sheets.Setup.grid.find(r => r[1] === 'Firebase project address')[2] = 'my-own-push';
safe('_openCopy');
console.log('opened again after typing a project:', JSON.stringify(val('Firebase project address')), '(kept - the check runs once per copy)');

// ---- 18 Nov, the snag batch from the cold test ----
ctx.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) };
const web = (params) => { ctx._e = { parameter: params }; return JSON.parse(vm.runInContext('doGet(_e)', ctx).text); };
const devRow = (id) => sheets.Devices.grid.find(r => r.join('|').indexOf(id) >= 0);
const lastRow = () => sheets.Bookings.grid[sheets.Bookings.grid.length - 1];
const setWait = (v) => { sheets.Setup.grid.find(r => r[1] === 'Wait before sending')[2] = v; };
console.log('===== 10. Set up in the copy asks for every permission first; the master never gets that far');
G.asked = 0; safe('pfsSetUp'); console.log('asked for all permissions:', G.asked, '| wait setting drawn:', JSON.stringify(val('Wait before sending')), '| message rows:', JSON.stringify(['Message column', 'Message column 2 (optional)', 'Message column 3 (optional)'].map(l => val(l))));
console.log('owner for the links:', JSON.stringify(vm.runInContext('pfsOwner_(pfsBook_())', ctx)), '| when Google will not say:', (G.owner = null, JSON.stringify(vm.runInContext('pfsOwner_(pfsBook_())', ctx)))); G.owner = undefined;
console.log('===== 11. a phone signs up through the web app: it is on Devices at once, and its page is told it is waiting');
const ecdh2 = crypto.createECDH('prime256v1'); ecdh2.generateKeys();
const ID_D = 'd169' + '0'.repeat(28);
const signUp = { action: 'subscribe', id: ID_D, endpoint: 'https://web.push.apple.com/D', p256dh: ecdh2.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url'), device: 'iPhone' };
console.log('sign-up answer:', JSON.stringify(web(signUp)), '| on Devices:', !!devRow(ID_D), '| lock left held by the web app:', G.lockHeld === true);
console.log('recent answer while waiting:', JSON.stringify(web({ action: 'recent', id: ID_D })));
{ const d = sheets.Devices.grid, h = d.findIndex(r => r.indexOf('Let in') >= 0); devRow(ID_D)[d[h].indexOf('Let in')] = true; }   // the owner ticks Let in
safe('runOnChange'); console.log('recent answer once let in:', JSON.stringify(web({ action: 'recent', id: ID_D })));
console.log('===== 12. a row typed by hand: marked Sending soon, the rest is typed during the wait, sent once with all of it');
setWait('30 seconds');   // the owner picks a wait after Set up (since 19 Nov Set up makes it Off for AppSheet Yes)
G.watch = vm.runInContext('ENGINE.SENDING', ctx);
sheets.Bookings.grid.push(['Typed slowly', '', '', '']);
let seen = [], typed = false; G.slept = 0; fetched.length = 0;
G.onSleep = () => { seen.push(lastRow()[4]); if (!typed) { typed = true; lastRow()[1] = 'Wall saw 3 m'; lastRow()[2] = '9 Slow St'; } };
safe('runOnChange'); G.onSleep = null;
console.log('mark while waiting:', JSON.stringify(seen[0]), '| waited seconds:', G.slept / 1000, '| pushes:', fetched.length, '| row now:', JSON.stringify(lastRow()[4]), '| lock held when marking Sending:', G.heldAtMark);
console.log('===== 13. another change starts while this run waits: this run stops, the newer one sends');
sheets.Bookings.grid.push(['Second row', 'Core drill', '1 New St', '']);
G.slept = 0; fetched.length = 0; G.onSleep = () => { props['pfs-wait'] = 'a-newer-run'; };
safe('runOnChange'); G.onSleep = null;
console.log('older run: waited seconds:', G.slept / 1000, '| pushes:', fetched.length, '| row says:', JSON.stringify(lastRow()[4]));
safe('runOnChange'); console.log('newer run: pushes:', fetched.length, '| row says:', JSON.stringify(lastRow()[4]));
console.log('===== 14. a row that keeps changing is not sent; the backup check sends it once it sits still');
sheets.Bookings.grid.push(['Never still', '', '', '']);
let n = 0; G.slept = 0; fetched.length = 0; G.onSleep = () => { lastRow()[1] = 'edit ' + (++n); };
safe('runOnChange'); G.onSleep = null;
console.log('waited seconds:', G.slept / 1000, '| pushes:', fetched.length, '| row says:', JSON.stringify(lastRow()[4]));
safe('runTimer'); console.log('backup check: pushes:', fetched.length, '| row says:', JSON.stringify(lastRow()[4]));
console.log('===== 15. Wait is Off: sent at once, no waiting');
setWait('Off'); sheets.Bookings.grid.push(['No wait', 'Hand saw', '2 Fast St', '']);
G.slept = 0; fetched.length = 0; safe('runOnChange');
console.log('waited seconds:', G.slept / 1000, '| pushes:', fetched.length, '| row says:', JSON.stringify(lastRow()[4]));
console.log('===== 16. the AppSheet answer moves the wait; a wait the owner picked stays');
const edit = (label) => { const r = sheets.Setup.grid.findIndex(x => x[1] === label) + 1; ctx._e = { range: { getSheet: () => sheets.Setup, getRow: () => r, getColumn: () => 3 } }; vm.runInContext('onEdit(_e)', ctx); };
const answer = (v) => { sheets.Setup.grid.find(r => r[1] === 'Making an AppSheet app?')[2] = v; edit('Making an AppSheet app?'); return val('Wait before sending'); };
console.log('No ->', answer('No'), '| Yes ->', answer('Yes'), '| picked 1 minute, then No ->', (setWait('1 minute'), answer('No')));
setWait('30 seconds');
console.log('===== 17. the owner changes the colour: the Devices tab follows on the next run; times use the sheet\'s own time zone');
console.log('Devices tab colour before:', sheets.Devices.getTabColor());
sheets.Setup.grid.find(r => r[1] === 'Colour')[2] = '#2E7D32'; G.zone = 'Pacific/Auckland'; G.zoneUsed = null;
safe('runOnChange'); console.log('Devices tab colour after:', sheets.Devices.getTabColor(), '| time zone used:', G.zoneUsed, '| phone still listed:', !!devRow(ID_D));
console.log('===== 18. opening the sheet refreshes Devices (a phone that signed up while it was closed) and never throws');
const ID_E = 'e777' + '0'.repeat(28); props['phone_' + ID_E] = JSON.stringify({ endpoint: 'https://web.push.apple.com/E', added: 1700000000000, lastSend: 0, lastCode: 0, approved: false, p256dh: signUp.p256dh, auth: signUp.auth });
ctx.SpreadsheetApp.getUi = () => ({ createMenu: () => any() });
safe('onOpen'); console.log('new phone on Devices after opening:', !!devRow(ID_E));
console.log('===== 19. typing while Set up runs is kept, and Set up says so');
G.onFetch = () => { sheets.Setup.grid.find(r => r[1] === 'App name')[2] = 'Typed Mid Run'; };
safe('pfsSetUp'); console.log('app name after the run:', JSON.stringify(val('App name')), '| said changed:', /You changed App name while Set up was running/.test(logs.join(' ')));
console.log('===== 20. a finished Set up opens the share box with All done on top');
G.dialog = null; ctx.SpreadsheetApp.getUi = () => ({ createMenu: () => any(), showModalDialog: (h, t) => { G.dialog = { title: t, html: h.getContent ? h.getContent() : String(h._html || '') }; }, alert: () => {}, ButtonSet: { OK: 1 } });
safe('pfsSetUp'); console.log('share box after Set up:', G.dialog && G.dialog.title, '| All done on top:', !!(G.dialog && /All done/.test(G.dialog.html)));
console.log('===== 21. the empty-project run: typing during it is kept');
sheets.Setup.grid.find(r => r[1] === 'Firebase project address')[2] = '';
G.afterRead = null; G.onFetch = null; safe('pfsSetUp'); G.traceReads = null;
sheets.Setup.grid.find(r => r[1] === 'Firebase project address')[2] = '';
G.dialog = null; G.afterRead = { n: 3, f: () => { sheets.Setup.grid.find(r => r[1] === 'Firebase project address')[2] = 'https://console.firebase.google.com/project/typed-late-1a2b/overview'; } };
safe('pfsSetUp'); console.log('said:', JSON.stringify(logs[logs.length - 1])); console.log('project after the empty run:', JSON.stringify(val('Firebase project address')));
console.log('===== 22. AppSheet Yes with Wait still at 30 seconds (onEdit missed it in a new copy): Set up makes it Off, and does not call it a change typed during the run');
sheets.Setup.grid.find(r => r[1] === 'Firebase project address')[2] = 'https://console.firebase.google.com/project/typed-late-1a2b/overview';
G.afterRead = null; G.onFetch = null;
sheets.Setup.grid.find(r => r[1] === 'Making an AppSheet app?')[2] = 'Yes'; setWait('30 seconds'); logs.length = 0;
safe('pfsSetUp'); console.log('wait after Set up:', JSON.stringify(val('Wait before sending')), '| said changed:', /You changed/.test(logs.join(' ')));
console.log('===== 23. a copy of the MASTER: an address pasted before its first open is kept (19 Nov: it was wiped)');
sheets.Setup.meta = [{ k: 'pfs-book', v: '1cEkCkMDHR85XqrXljxhCz8w_LEZTNxWlts5GbpybLyA' }];   // what a fresh copy of the master carries
G.bookId = 'BOOK-MASTER-COPY'; G.scriptId = 'SCRIPT-MASTER-COPY';
sheets.Setup.grid.find(r => r[1] === 'Firebase project address')[2] = 'https://console.firebase.google.com/project/pasted-fast-9z/overview';
safe('_openCopy'); console.log('address after the first open:', JSON.stringify(val('Firebase project address')));
