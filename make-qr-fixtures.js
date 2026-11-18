// make-qr-fixtures.js - makes qr-fixtures.json with an OUTSIDE library (npm "qrcode", soldair/node-qrcode), so
// test-qr.js can compare our own QR maker against somebody else's, offline. Only needed again if the texts change.
// Run:  (in any folder) npm install qrcode ; NODE_PATH=<that folder>/node_modules node make-qr-fixtures.js
const QRCode = require('qrcode');
const fs = require('node:fs');
const texts = [
  'hi',
  'abcdefghijklmn',                                   // 14 bytes: the most version 1 holds
  'abcdefghijklmno',                                  // 15 bytes: the first that needs version 2
  'café – push ✓',                           // letters outside plain English (UTF-8)
  'https://smith-cutting-push-a1b2c3.web.app/',       // a real-shaped page address (version 3)
  'https://smith-cutting-push-a1b2c3d.web.app/',      // 43 bytes: the first that needs version 4
  'https://example.web.app/?' + 'y'.repeat(38),       // 63 bytes: the first that needs version 5
  'https://example.web.app/?' + 'x'.repeat(81)        // 106 bytes: the most version 6 holds
];
const out = [];
texts.forEach(function (text) {
  const auto = QRCode.create([{ data: text, mode: 'byte' }], { errorCorrectionLevel: 'M' });
  for (let mask = 0; mask < 8; mask++) {
    const q = QRCode.create([{ data: text, mode: 'byte' }], { errorCorrectionLevel: 'M', maskPattern: mask });
    const size = q.modules.size, rows = [];
    for (let y = 0; y < size; y++) { let s = ''; for (let x = 0; x < size; x++) s += q.modules.data[y * size + x] ? '1' : '0'; rows.push(s); }
    out.push({ text: text, version: q.version, mask: mask, outsideAutoMask: auto.maskPattern, rows: rows });
  }
});
fs.writeFileSync(__dirname + '/qr-fixtures.json', JSON.stringify({ madeWith: 'npm qrcode ' + require('qrcode/package.json').version + ', level M, byte mode', cases: out }));
console.log('wrote', out.length, 'cases; versions', [...new Set(out.map(c => c.version))].join(','), '; outside auto masks', texts.map(t => out.find(c => c.text === t).outsideAutoMask).join(','));
