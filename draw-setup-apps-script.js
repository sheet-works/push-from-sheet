// draw-setup-apps-script.js - Apps Script only. Draws the Setup tab that SETUPTAB.build decided, in look B
// (the pick 17 Nov 2026). Colours, fonts, row heights and borders were read off the mock-up tab 'B Setup'
// (sheet 1B4ol5o3Um4Vn884O_oMYPZl7wokfbv2puM9o-cgiXcM) on 18 Nov, so it copies his pick, not a look of Claude's.
// The band and the section titles take the owner's colour.
var LOOKB = { page: '#EDF0F4', ink: '#1F2023', grey: '#5F6268', card: '#FFFFFF', line: '#DADCDF', faint: '#F0F3F4',
  field: '#F8F8F9', sub: '#DCE6F5', font: 'Roboto' };
var LOOKB_HEIGHT = { band: 14, title: 42, subtitle: 21, statushead: 26, status: 32, gap: 21, section: 34, setting: 30, step: 30, phonepage: 40, note: 24 };

// sheet = the tab to draw on (its old drawing is cleared first; values come from built.rows, which kept the owner's).
function setupDraw_(sheet, built, colour) {
  var t0 = Date.now(), part = function (what) { Logger.log('Drawing - ' + what + ': ' + Math.round((Date.now() - t0) / 100) / 10 + ' s'); };   // where the drawing time goes (18 Nov)
  var n = built.rows.length, W = 5, kinds = built.kinds, keep = built.share ? built.share.col : W + 1;   // the share panel needs F (gap) and G
  var old = sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), n), Math.max(sheet.getMaxColumns(), W));
  old.breakApart(); old.clearDataValidations(); old.clearFormat(); old.clearContent();
  if (sheet.getMaxRows() > n + 5) sheet.deleteRows(n + 6, sheet.getMaxRows() - n - 5);
  if (sheet.getMaxColumns() < keep) sheet.insertColumnsAfter(sheet.getMaxColumns(), keep - sheet.getMaxColumns());
  if (sheet.getMaxColumns() > keep) sheet.deleteColumns(keep + 1, sheet.getMaxColumns() - keep);
  sheet.setHiddenGridlines(true);
  sheet.setColumnWidth(1, 28);
  sheet.setColumnWidths(2, 4, 200);
  if (built.share) { sheet.setColumnWidth(6, 21); sheet.setColumnWidth(built.share.col, built.share.width); }
  sheet.setTabColor(colour);

  var whole = sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns());
  whole.setBackground(LOOKB.page).setFontFamily(LOOKB.font).setFontSize(10).setFontColor(LOOKB.ink).setVerticalAlignment('middle');
  sheet.getRange(1, 1, n, W).setValues(built.rows);
  part('cleared and filled');

  var groups = {};   // style name -> list of A1 ranges, so each style is set in one go
  var put = function (style, a1) { (groups[style] = groups[style] || []).push(a1); };
  var r = function (row, from, to) { return from + row + (to ? ':' + to + row : ''); };
  kinds.forEach(function (kind, i) {
    var row = i + 1;
    if (kind === 'band' || kind === 'title' || kind === 'subtitle') { put('band', r(row, 'A', 'E')); if (kind !== 'band') put(kind, r(row, 'B', 'E')); return; }
    if (kind === 'gap') return;
    put('card', r(row, 'B', 'E'));
    put('sides', r(row, 'B', 'E'));
    if (i + 1 >= kinds.length || kinds[i + 1] === 'gap') put('blockEnd', r(row, 'B', 'E'));
    if (kind === 'statushead') put('statushead', r(row, 'B', 'E'));
    else if (kind === 'status') put('notyet', r(row, 'B', 'E'));
    else if (kind === 'section') { put('section', r(row, 'B', 'E')); put('blockStart', r(row, 'B', 'E')); put('merge', r(row, 'B', 'E')); }
    else if (kind === 'setting' || kind === 'step') {
      put('label', r(row, 'B')); put('rowline', r(row, 'B', 'E')); put('help', r(row, 'D', 'E')); put('merge', r(row, 'D', 'E'));
      put(kind === 'setting' ? 'field' : 'notyet', r(row, 'C'));
    }
    else if (kind === 'phonepage') {   // the QR picture lives in the share panel now (18 Nov)
      put('phonelabel', r(row, 'B')); put('phonevalue', r(row, 'C', 'E')); put('merge', r(row, 'C', 'E'));
    }
    else if (kind === 'note') { put('help', r(row, 'B', 'E')); put('rowline', r(row, 'B', 'E')); put('merge', r(row, 'B', 'E')); }
  });
  // Row heights in runs: one call per run of equal heights instead of one per row (speed, 18 Nov: drawing was ~19 s).
  for (var start = 0; start < kinds.length;) {
    var h = LOOKB_HEIGHT[kinds[start]] || 21, end = start;
    while (end + 1 < kinds.length && (LOOKB_HEIGHT[kinds[end + 1]] || 21) === h) end++;
    if (end === start) sheet.setRowHeight(start + 1, h); else sheet.setRowHeights(start + 1, end - start + 1, h);
    start = end + 1;
  }
  var each = function (style, fn) { if (groups[style]) fn(sheet.getRangeList(groups[style])); };
  var SOLID = SpreadsheetApp.BorderStyle.SOLID;
  each('band', function (l) { l.setBackground(colour).setFontColor('#FFFFFF'); });
  each('title', function (l) { l.setFontSize(22).setFontWeight('bold'); });
  each('subtitle', function (l) { l.setFontColor(LOOKB.sub); });
  each('card', function (l) { l.setBackground(LOOKB.card); });
  each('statushead', function (l) { l.setFontSize(8).setFontWeight('bold').setFontColor(LOOKB.grey); });
  each('notyet', function (l) { l.setBackground(LOOKB.faint).setFontWeight('bold').setFontColor(LOOKB.grey); });
  each('section', function (l) { l.setFontSize(12).setFontWeight('bold').setFontColor(colour); });
  each('label', function (l) { l.setFontColor(LOOKB.grey); });
  each('help', function (l) { l.setFontSize(9).setFontColor(LOOKB.grey).setWrap(true); });
  each('phonelabel', function (l) { l.setFontWeight('bold').setFontColor(colour); });
  each('phonevalue', function (l) { l.setFontStyle('italic').setFontColor(LOOKB.grey); });
  each('rowline', function (l) { l.setBorder(null, null, true, null, null, null, LOOKB.faint, SOLID); });
  each('field', function (l) { l.setBackground(LOOKB.field).setBorder(null, null, true, null, null, null, colour, SOLID); });
  each('sides', function (l) { l.setBorder(null, true, null, true, null, null, LOOKB.line, SOLID); });
  each('blockStart', function (l) { l.setBorder(true, null, null, null, null, null, LOOKB.line, SOLID); });
  each('blockEnd', function (l) { l.setBorder(null, null, true, null, null, null, LOOKB.line, SOLID); });
  (groups.merge || []).forEach(function (a1) { sheet.getRange(a1).merge(); });
  part('styled and merged');

  // The ticks: green done, amber needs you, red failed, grey not yet (look B mock-up colours). The reason beside a
  // failed step (column D) only takes the colour of its words.
  var TONE = { green: ['#E6F4EA', '#137333'], amber: ['#FDF7DF', '#895A00'], red: ['#FBE8E6', '#C5211F'], grey: [LOOKB.faint, LOOKB.grey],
    live: ['#E6F4EA', '#137333'] };   // the LIVE pill in the heading (18 Nov)
  var byTone = {};
  // The empty Firebase project box stands out with a thick border in the owner's colour (cold test 2): it is the one
  // box a new owner must fill, and it must not look like the yellow status boxes.
  var need = (built.tones || []).filter(function (t) { return t.tone === 'need'; }).map(function (t) { return sheet.getRange(t.row, t.col).getA1Notation(); });
  if (need.length) sheet.getRangeList(need).setBackground(LOOKB.card).setBorder(true, true, true, true, null, null, colour, SpreadsheetApp.BorderStyle.SOLID_THICK);
  (built.tones || []).filter(function (t) { return t.tone !== 'need'; }).forEach(function (t) {
    var key = t.tone + (t.col === 4 ? ':words' : ':cell');
    (byTone[key] = byTone[key] || []).push(sheet.getRange(t.row, t.col).getA1Notation());
  });
  Object.keys(byTone).forEach(function (key) {
    var tone = TONE[key.split(':')[0]], list = sheet.getRangeList(byTone[key]);
    if (key.split(':')[1] === 'words') list.setFontColor(tone[1]);
    else list.setBackground(tone[0]).setFontColor(tone[1]).setFontWeight('bold');
  });

  // Column dropdowns read the owner's heading row itself (18 Nov), so a renamed heading shows at once and a stale
  // pick gets Sheets' own red mark. Others are plain lists.
  // The owner's tab and its width are looked up once (each look is a read that stalls the drawing, 18 Nov).
  var book = null, heads = {};
  var headerRow = function (name) {
    if (name in heads) return heads[name];
    if (!book) book = sheet.getParent();
    var tab = book.getSheetByName(name), last = tab ? tab.getLastColumn() : 0;
    return (heads[name] = last ? tab.getRange(1, 1, 1, last) : null);
  };
  built.dropdowns.forEach(function (d) {
    var rule = SpreadsheetApp.newDataValidation(), from = d.fromHeader ? headerRow(d.fromHeader) : null;
    if (from) rule = rule.requireValueInRange(from, true);
    else rule = rule.requireValueInList(d.list, true);
    sheet.getRange(d.row, 3).setDataValidation(rule.setAllowInvalid(!d.strict).build());
  });
  // The heading band and section titles follow the Colour dropdown as soon as a name is picked (18 Nov).
  // A typed code shows on the next Set up (that is the plain colour above).
  if (built.colourRow) {
    var rules = [], bandA1 = groups.band || [], titleA1 = (groups.section || []).concat(groups.phonelabel || []);
    // The LIVE pill sits on the band: its own rule goes first (the first rule that matches a cell wins), so a picked
    // colour never paints over it and it stays light green and readable (18 Nov, Green made it vanish).
    (built.tones || []).filter(function (t) { return t.tone === 'live'; }).forEach(function (t) {
      var cell = sheet.getRange(t.row, t.col), at = '$' + String.fromCharCode(64 + t.col) + '$' + t.row;   // e.g. $E$2
      rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=LEN(' + at + ')>0')
        .setBackground(TONE.live[0]).setFontColor(TONE.live[1]).setRanges([cell]).build());
    });
    Object.keys(SETUP.COLOURS).forEach(function (name) {
      var when = '=LOWER(TRIM($C$' + built.colourRow + '))="' + name.toLowerCase() + '"', hex = SETUP.COLOURS[name];
      if (bandA1.length) rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(when).setBackground(hex)
        .setRanges(bandA1.map(function (a) { return sheet.getRange(a); })).build());
      if (titleA1.length) rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(when).setFontColor(hex)
        .setRanges(titleA1.map(function (a) { return sheet.getRange(a); })).build());
    });
    sheet.setConditionalFormatRules(rules);
  }
  part('ticks, dropdowns, colour rules');
  // Only the words up to the › are the link (bold, owner's colour); anything after stays plain grey help text.
  built.links.forEach(function (k) {
    // A link with its own start and end (an address inside a failed step's reason) covers just that part.
    var from = k.end ? k.start : 0, end = k.end || k.text.indexOf('›') + 1 || k.text.length;
    var bold = SpreadsheetApp.newTextStyle().setBold(true).setForegroundColor(colour).build();
    sheet.getRange(k.row, k.col).setRichTextValue(SpreadsheetApp.newRichTextValue().setText(k.text)
      .setLinkUrl(from, end, k.url).setTextStyle(from, end, bold).build());
  });
  // The share panel to the right of the card (18 Nov): a white box in column G, the QR placed over it by pfsPlaceQr_.
  if (built.share) {
    var sh = built.share, G = sh.col;
    sheet.getRange(sh.top, G, sh.bottom - sh.top + 1, 1).setBackground(LOOKB.card).setBorder(true, true, true, true, null, null, LOOKB.line, SOLID)
      .setHorizontalAlignment('center').setWrap(true);
    sh.cells.forEach(function (c) {
      var cell = sheet.getRange(c.row, G);
      if (c.kind === 'sharelink') {
        var linkStyle = SpreadsheetApp.newTextStyle().setBold(true).setForegroundColor(colour).build();
        cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(c.text).setLinkUrl(c.url).setTextStyle(linkStyle).build());
      } else {
        cell.setValue(c.text);
        if (c.kind === 'sharetitle') cell.setFontSize(12).setFontWeight('bold').setFontColor(colour);
        else cell.setFontSize(9).setFontColor(LOOKB.grey);
      }
    });
  }
  part('links and share panel');
  SpreadsheetApp.flush(); part('Google has drawn it');
  // The boxes Set up fills in warn before anyone types over them (cold test 2: a project name typed into the status box).
  // Warning only: the owner can still go ahead, and the script itself is never stopped.
  sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) { if (p.getDescription() === SETUP_LOCK_NOTE) p.remove(); });
  (built.locked || []).forEach(function (l) {
    sheet.getRange(l.row, l.col, l.rows, l.cols).protect().setDescription(SETUP_LOCK_NOTE).setWarningOnly(true);
  });
  SpreadsheetApp.flush(); part('locks');
}
var SETUP_LOCK_NOTE = 'Push from sheet fills this in - type in the white boxes';

// ---- The Phones tab in look B (mock-up 'B Phones', read 18 Nov): band with the title, count pills, a line of help,
// a header on row 6 underlined in the owner's colour, phone rows from row 7. The colour rules are the mock-up's own:
// On = green, Waiting = amber (row tinted), Gone = struck through in grey. The ID column (J) is hidden.
var PHONES_WIDTHS = [28, 130, 190, 160, 64, 120, 120, 120, 230, 28];

// frame = PHONETAB.frame(...); rows = the phone rows PHONETAB.sync gave (9 cells each, Name ... ID).
function phonesDraw_(sheet, frame, rows, colour) {
  var W = 10, first = frame.firstDataRow, n = rows.length, last = Math.max(first + n + 5, first + 20);
  var all = sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), last), Math.max(sheet.getMaxColumns(), W));
  all.breakApart(); all.clearDataValidations(); all.clearFormat(); all.clearContent();
  sheet.clearConditionalFormatRules();
  if (sheet.getMaxRows() > last) sheet.deleteRows(last + 1, sheet.getMaxRows() - last);
  if (sheet.getMaxRows() < last) sheet.insertRowsAfter(sheet.getMaxRows(), last - sheet.getMaxRows());
  if (sheet.getMaxColumns() > W) sheet.deleteColumns(W + 1, sheet.getMaxColumns() - W);
  sheet.setHiddenGridlines(true);
  sheet.setTabColor(colour);
  PHONES_WIDTHS.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  sheet.getRange(1, 1, last, W).setBackground(LOOKB.page).setFontFamily(LOOKB.font).setFontSize(10).setFontColor(LOOKB.ink).setVerticalAlignment('middle');
  // Dates are written as text, so the sheet shows them as written ('17 Nov 7:37 pm'), not as 24-hour sheet dates.
  sheet.getRange(first, 6, last - first + 1, 3).setNumberFormat('@');

  sheet.getRange(1, 1, frame.rows.length, W).setValues(frame.rows);
  if (n) sheet.getRange(first, frame.firstCol, n, 9).setValues(rows);

  [14, 48, 36, 21, 21, 32].forEach(function (h, i) { sheet.setRowHeight(i + 1, h); });
  sheet.setRowHeights(first, last - first + 1, 34);   // one call for all the device rows (speed, 18 Nov)
  sheet.getRange(1, 1, 2, W).setBackground(colour).setFontColor('#FFFFFF');
  sheet.getRange(2, 2).setFontSize(20).setFontWeight('bold');
  var pill = function (a1, bg, ink) { sheet.getRange(a1).setBackground(bg).setFontColor(ink).setFontSize(11).setFontWeight('bold').setHorizontalAlignment('center'); };
  pill('B3', '#E6F4EA', '#137333'); pill('D3', '#FDF7DF', '#895A00'); pill('F3', LOOKB.faint, LOOKB.grey);
  sheet.getRange(5, 2).setFontSize(9).setFontColor(LOOKB.grey);
  var SOLID = SpreadsheetApp.BorderStyle.SOLID, h = frame.headerRow;
  sheet.getRange(h, 2, 1, 8).setBackground(LOOKB.card).setFontSize(9).setFontWeight('bold').setFontColor(LOOKB.grey)
    .setBorder(true, true, null, true, null, null, LOOKB.line, SOLID).setBorder(null, null, true, null, null, null, colour, SOLID);
  sheet.getRange(h, 5).setHorizontalAlignment('center');
  sheet.setFrozenRows(h);

  // The table is drawn down to the last row, so phones that join later land in it (phonesFill_ only writes values).
  var size = last - first + 1;
  sheet.getRange(first, 2, size, 8).setBackground(LOOKB.card).setBorder(null, true, true, true, null, true, '#EBECEE', SOLID)
    .setBorder(null, true, true, true, null, null, LOOKB.line, SOLID);
  sheet.getRange(first, 3, size, 1).setFontSize(9).setFontColor(LOOKB.grey);
  sheet.getRange(first, 5, size, 1).setHorizontalAlignment('center');
  if (n) sheet.getRange(first, 5, n, 1).insertCheckboxes();
  var area = sheet.getRange(first, 2, last - first + 1, 8), status = sheet.getRange(first, 9, last - first + 1, 1);
  var tint = sheet.getRange(first, 2, last - first + 1, 7), I = '$I' + first, S = PHONETAB.STATUS_START;
  var rule = function () { return SpreadsheetApp.newConditionalFormatRule(); };
  sheet.setConditionalFormatRules([
    rule().whenFormulaSatisfied('=LEFT(' + I + ',' + S.gone.length + ')="' + S.gone + '"').setFontColor('#9A9FA6').setStrikethrough(true).setRanges([area]).build(),
    rule().whenFormulaSatisfied('=LEFT(' + I + ',' + S.waiting.length + ')="' + S.waiting + '"').setBackground('#FFFAEF').setRanges([tint]).build(),
    rule().whenFormulaSatisfied('=LEFT(' + I + ',' + S.waiting.length + ')="' + S.waiting + '"').setBackground('#FDF7DF').setFontColor('#895A00').setBold(true).setRanges([status]).build(),
    rule().whenFormulaSatisfied('=' + I + '="' + S.on + '"').setBackground('#E6F4EA').setFontColor('#137333').setBold(true).setRanges([status]).build()
  ]);
  sheet.hideColumns(W);
  SpreadsheetApp.flush();
}

// Writes only the values: the title, the counts and the phone rows (the drawing is already there).
function phonesFill_(sheet, frame, rows) {
  var first = frame.firstDataRow, size = sheet.getMaxRows() - first + 1, n = rows.length;
  sheet.getRange(2, 2).setValue(frame.rows[1][1]);
  sheet.getRange(3, 1, 1, frame.rows[2].length).setValues([frame.rows[2]]);
  var area = sheet.getRange(first, frame.firstCol, size, 9);
  area.clearContent();
  sheet.getRange(first, 5, size, 1).removeCheckboxes();
  if (n) {
    sheet.getRange(first, frame.firstCol, n, 9).setValues(rows);
    sheet.getRange(first, 5, n, 1).insertCheckboxes();
  }
  SpreadsheetApp.flush();
}

