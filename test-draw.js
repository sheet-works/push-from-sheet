'use strict';
// Tests for draw-setup-apps-script.js - the drawing of the Setup tab, run against a pretend sheet that records what it is told.
// Run: node --test test-draw.js   (always name the test files)
// Rule: written BEFORE the fix and seen to fail first.
// 18 Nov: picking Green made the LIVE mark dark green on a green band - you could hardly read it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), vm = require('vm'), path = require('path');
const here = __dirname;
const SETUP = require(path.join(here, 'setup.js'));
const SETUPTAB = require(path.join(here, 'setuptab.js'));
const STEPS = require(path.join(here, 'steps.js'));

const letter = (c) => String.fromCharCode(64 + c);
const a1 = (row, col) => letter(col) + row;
// Is the single cell (row, col) inside an A1 range like 'A2:E2' or 'E2'?
function covers(range, row, col) {
  const m = /^([A-Z])(\d+)(?::([A-Z])(\d+))?$/.exec(range);
  const c1 = m[1].charCodeAt(0) - 64, r1 = +m[2], c2 = m[3] ? m[3].charCodeAt(0) - 64 : c1, r2 = m[4] ? +m[4] : r1;
  return row >= r1 && row <= r2 && col >= c1 && col <= c2;
}

function drawn(colour, facts) {
  const rules = [], linked = [], locks = [], removed = [], borders = [], heights = {}, heightCalls = [], parentReads = [];
  const chain = (extra) => new Proxy(function () {}, {
    get: (t, p) => (p === Symbol.toPrimitive ? () => 0 : p in extra ? extra[p] : () => chain(extra)), apply: () => chain(extra) });   // sizes read as 0
  const values = {}, merges = [], widths = {};
  const rangeOf = (a, b) => { const name = typeof a === 'number' ? a1(a, b) : a; const r = chain({ getA1Notation: () => name, a1: name,
    setValue: (v) => { values[name] = v; return r; }, setRichTextValue: (v) => { values[name] = 'rich'; return r; },
    merge: () => { merges.push(name); return r; },
    protect: () => { const p = { range: name }; locks.push(p); const q = chain({ setDescription: (d) => { p.note = d; return q; }, setWarningOnly: (w) => { p.warn = w; return q; } }); return q; } }); return r; };
  const sheet = chain({
    setRowHeight: (r, h) => { heights[r] = h; heightCalls.push(1); return sheet; },
    setRowHeights: (r, n, h) => { for (let i = 0; i < n; i++) heights[r + i] = h; heightCalls.push(n); return sheet; },
    getRange: rangeOf, getRangeList: (list) => { const l = chain({ setBorder: (...a) => { borders.push({ list: list, args: a }); return l; } }); return l; },
    getProtections: () => [{ getDescription: () => 'Push from sheet fills this in - type in the white boxes', remove: () => removed.push('ours') },
      { getDescription: () => 'the owner\'s own lock', remove: () => removed.push('theirs') }],
    setColumnWidth: (c, w) => { widths[c] = w; return sheet; }, setColumnWidths: (c, n, w) => { for (let i = 0; i < n; i++) widths[c + i] = w; return sheet; }, getParent: () => { parentReads.push(1); return chain({ getSheetByName: () => null }); },
    setConditionalFormatRules: (r) => { rules.push(...r); return sheet; } });
  const ruleBuilder = () => {
    const r = { ranges: [] };
    const b = new Proxy({}, { get: (t, p) => {
      if (p === 'build') return () => r;
      if (p === 'whenFormulaSatisfied') return (f) => { r.formula = f; return b; };
      if (p === 'setBackground') return (h) => { r.background = h; return b; };
      if (p === 'setFontColor') return (h) => { r.font = h; return b; };
      if (p === 'setRanges') return (list) => { r.ranges = list.map(x => x.a1); return b; };
      return () => b; } });
    return b;
  };
  const ctx = { SETUP, Object, Array, String, Math, JSON, Date, Logger: { log: () => {} },
    SpreadsheetApp: { newConditionalFormatRule: ruleBuilder, newDataValidation: () => chain({}), newTextStyle: () => chain({}),
      newRichTextValue: () => { const r = chain({ setLinkUrl: (a, b, c) => { linked.push(c === undefined ? { url: a } : { start: a, end: b, url: c }); return r; } }); return r; }, flush: () => {}, BorderStyle: { SOLID: 'SOLID', SOLID_THICK: 'SOLID_THICK' }, ProtectionType: { RANGE: 'RANGE' } } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(here, 'draw-setup-apps-script.js'), 'utf8'), ctx);
  const steps = {}; STEPS.names().forEach(n => { steps[n] = { ok: true }; });
  const book = { name: 'Smith Cutting', tabs: ['Jobs'], headers: { Jobs: ['Title', 'Details', 'Push To'] } };
  const built = SETUPTAB.build(book, [], facts || { apiSwitch: true, steps, page: 'https://x.web.app/' });
  ctx.setupDraw_(sheet, built, colour || SETUP.COLOURS.Blue);
  return { rules, built, values, merges, widths, linked, locks, removed, borders, heights, heightCalls, parentReads };
}

test('LIVE stays readable whatever colour is picked: the first rule over its cell keeps the light green pill', () => {
  const { rules, built } = drawn();
  const live = built.tones.find(t => t.tone === 'live');
  assert.ok(live, 'LIVE is shown when every step is done');
  const first = rules.find(r => r.ranges.some(x => covers(x, live.row, live.col)));
  assert.ok(first, 'a rule covers the LIVE cell');
  assert.equal(first.background, '#E6F4EA');
  assert.equal(first.font, '#137333');
});

test('every colour name still has its band rule, so the rest of the band follows the pick', () => {
  const { rules } = drawn();
  Object.keys(SETUP.COLOURS).forEach(name => {
    assert.ok(rules.some(r => r.background === SETUP.COLOURS[name] && r.ranges.some(x => covers(x, 2, 2))), name);
  });
});

test('share panel: its words go in column G, the link is a real link, G is wide enough for the QR and F is a narrow gap (18 Nov)', () => {
  const { built, values, widths } = drawn();
  built.share.cells.forEach(c => {
    const at = 'G' + c.row;
    if (c.kind === 'sharelink') assert.equal(values[at], 'rich', 'the link at ' + at + ' can be clicked');
    else assert.equal(values[at], c.text, at);
  });
  assert.equal(widths[7], built.share.width, 'G is as wide as the panel says - one truth');
  assert.ok(widths[6] <= 30, 'F is just a gap');
});

test('the Sign-up page row in the card spans C to E again - the QR lives in the panel now', () => {
  const { built, merges } = drawn();
  assert.ok(merges.includes('C' + built.page.row + ':E' + built.page.row), merges.join(' '));
});

test('a link inside a failed step\'s reason covers just the address; a help line\'s link still covers the words up to the arrow (18 Nov: "this isn\'t clickable")', () => {
  const why = 'The switch is off. Open https://script.google.com/home/usersettings and turn it On.';
  const { linked, built } = drawn(null, { steps: { 'Switch on services': { ok: true }, 'Publish as a web app': { error: why } } });
  const k = linked.find(x => x.url === 'https://script.google.com/home/usersettings' && x.start > 0);
  assert.ok(k, 'the reason\'s address is linked: ' + JSON.stringify(linked));
  assert.equal(why.slice(k.start, k.end), 'https://script.google.com/home/usersettings');
  const help = built.rows.find(r => r[1] === SETUP.PROJECT_LABEL)[3];
  assert.ok(linked.some(x => x.start === 0 && x.end === help.indexOf('›') + 1 && x.url === 'https://console.firebase.google.com/'));
});

// ---- cold test 2, 18 Nov 9pm ----
test('the boxes Set up fills in get a warning-only lock; our old locks are taken off first, the owner\'s own are left', () => {
  const d = drawn();
  assert.ok(d.locks.length >= 3);
  d.locks.forEach(l => { assert.equal(l.warn, true, l.range); assert.equal(l.note, 'Push from sheet fills this in - type in the white boxes'); });
  assert.deepEqual(d.removed, ['ours']);
});

test('the empty Firebase project box gets a thick border in the owner\'s colour', () => {
  const d = drawn(SETUP.COLOURS.Blue, { steps: {} });
  const row = d.built.rows.findIndex(r => r[1] === 'Firebase project address') + 1;
  const b = d.borders.find(x => x.args[7] === 'SOLID_THICK');
  assert.ok(b, 'a thick border was drawn');
  assert.deepEqual(b.list, ['C' + row]);
  assert.equal(b.args[6], SETUP.COLOURS.Blue);
});

// ---- speed, 18 Nov 10:50pm: drawing took ~19 s of a 45 s Set up (cloud log). Fewer calls, same picture ----
test('row heights: every row gets the height of its kind, set in runs (one call per run of equal heights, not one per row)', () => {
  const d = drawn();
  const H = { band: 14, title: 42, subtitle: 21, statushead: 26, status: 32, gap: 21, section: 34, setting: 30, step: 30, phonepage: 40, note: 24 };
  d.built.kinds.forEach((k, i) => assert.equal(d.heights[i + 1], H[k] || 21, 'row ' + (i + 1) + ' ' + k));
  let runs = 1; for (let i = 1; i < d.built.kinds.length; i++) if ((H[d.built.kinds[i]] || 21) !== (H[d.built.kinds[i - 1]] || 21)) runs++;
  assert.equal(d.heightCalls.length, runs);
});

test('dropdowns: the sheet is asked for its tabs once, not once per dropdown', () => {
  assert.ok(drawn().parentReads.length <= 1, 'parent reads: ' + drawn().parentReads.length);
});
