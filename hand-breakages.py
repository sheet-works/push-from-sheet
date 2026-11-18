import subprocess, os, sys
here = os.getcwd()
src = open("SHARE - paste into the sheet's Apps Script.gs", encoding='utf8').read()
B = [
 ('wait: a newer run is ignored', "if (props.getProperty(RUN_WAIT) !== me) {", "if (false) {", 'older run:'),
 ('wait: rows not read again after the wait', "    if (!lock.tryLock(20000)) return null;\n    t = runRead_();", "    if (!lock.tryLock(20000)) return null;", 'ROW 4'),
 ('wait: no second look at a row that changed', "    if (rows.length === Object.keys(now).length) break;", "    break;", 'mark while waiting'),
 ('wait: not marked Sending soon', "    runNote_(t, Object.keys(before).map(Number), ENGINE.SOON);", "", 'mark while waiting'),
 ('wait: unsettled rows sent anyway', "plans = ENGINE.ready(ENGINE.plan(t.header, t.rows, t.settings, phones, PFS_ENV.page(), retry), w.rows);", "plans = ENGINE.plan(t.header, t.rows, t.settings, phones, PFS_ENV.page(), retry);", '^waited seconds: 90'),
 ('wait: Off still sleeps', "  if (!wait) return { t: t, rows: null };", "  if (!wait) wait = 30;", '^waited seconds: 0'),
 ('sign-up not shown on Devices at once', "if (answer && answer.ok && (did === 'subscribe' || did === 'unsubscribe')) {", "if (false) {", 'sign-up answer'),
 ('copy keeps the original devices listed', "if (devices) phonesDraw_(devices, PHONETAB.frame(s.appName, { on: 0, waiting: 0, gone: 0 }), [], s.colour);", "", 'lists the old phone'),
 ('Devices colour does not follow', " || tint !== String(s.colour).toUpperCase()) phonesDraw_", ") phonesDraw_", 'Devices tab colour after'),
 ('times in the script zone', "return PFS_ENV.book().getSpreadsheetTimeZone() || Session.getScriptTimeZone();", "return Session.getScriptTimeZone();", 'Devices tab colour after'),
 ('all permissions not asked', "if (typeof ScriptApp.requireAllScopes === 'function') ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);", "", 'asked for all'),
 ('lock let go while marking Sending', "  if (!held) lock.waitLock(20000);", "  lock.waitLock(20000); held = false;", 'lock held when'),
 ('opening the sheet does not refresh Devices', "if (book.getSheetByName(PHONETAB.TAB_NAME)) runSyncPhones_(book, r.settings);", "", 'after opening'),
 ('AppSheet answer does not move the wait', "if (change) sheet.getRange(change.row, change.col).setValue(change.value);", "", '^No ->'),
 ('master links name the owner', "  if (MENU.isMaster(book.getId())) return '';\n  try { var o = book.getOwner();", "  try { var o = book.getOwner();", 'owner named in the master'),
 ('owner never read', "var o = book.getOwner(); return o ? String(o.getEmail() || '') : '';", "return '';", 'owner for the links'),
 ('typing during an empty run drawn over', "    if (SETUPTAB.typedDuring(current, now).length) {", "    if (false) {", 'project after the empty run'),
 ('typing during the steps drawn over', "  built = SETUPTAB.build(info, now2, facts);", "  built = SETUPTAB.build(info, current, facts);", 'app name after the run'),
 ('typing during the steps not mentioned', "  if (late.length) { pfsSay_(", "  if (false) { pfsSay_(", 'said changed'),
 ('share box not opened at the end', "  if (STEPS.finished(facts)) pfsShowShare_(", "  if (false) pfsShowShare_(", 'share box after Set up'),
 ('share box without All done', "MENU.shareHtml(page, png, s.appName || MENU.TITLE, s.colour, lead)", "MENU.shareHtml(page, png, s.appName || MENU.TITLE, s.colour)", 'All done on top'),
]
def run(text):
    open('/tmp/b.gs', 'w', encoding='utf8').write(text)
    return subprocess.run(['node', os.path.join(here, 'rehearse-setup.js'), '/tmp/b.gs'], capture_output=True, text=True).stdout.split('\n')
import re
base = run(src)
pick = lambda lines, pat: [l[:150] for l in lines if re.search(pat, l)]
bad = 0
for name, old, new, pat in B:
    if src.count(old) != 1: print('SETUP PROBLEM', name, src.count(old)); bad += 1; continue
    a, b = pick(base, pat), pick(run(src.replace(old, new)), pat)
    if a == b: print('SURVIVED ', name); bad += 1
    else: print('caught   ', name, '\n     was:', a[:1], '\n     now:', b[:1])
print(len(B), 'hand breakages,', bad, 'survived')
