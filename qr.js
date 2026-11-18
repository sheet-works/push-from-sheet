// qr.js - our own QR code maker (the pick 18 Nov 2026: our own code, nobody else's service in the middle).
// Makes the square of dark and light cells for a short text such as the sign-up page's address.
// Kept small on purpose: plain "byte" text, error correction level M, sizes 1 to 6 (up to 106 bytes - a page
// address is under 50). Checked against an outside library in test-qr.js. Runs in Apps Script and in Node.
var QR = (function () {
  'use strict';

  // Per size (version 1 to 6) at level M: check bytes per block, and the blocks as [how many, data bytes each].
  var SIZES = [null,
    { ec: 10, blocks: [[1, 16]] }, { ec: 16, blocks: [[1, 28]] }, { ec: 26, blocks: [[1, 44]] },
    { ec: 18, blocks: [[2, 32]] }, { ec: 24, blocks: [[2, 43]] }, { ec: 16, blocks: [[4, 27]] }];
  function dataBytes(v) { return SIZES[v].blocks.reduce(function (n, b) { return n + b[0] * b[1]; }, 0); }

  function utf8(str) {
    var out = [], s = unescape(encodeURIComponent(String(str)));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  // ---- the check bytes (Reed-Solomon over GF(256), polynomial 0x11D) ----
  var EXP = [], LOG = [];
  (function () { var x = 1; for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; } })();
  function mul(a, b) { return (a && b) ? EXP[(LOG[a] + LOG[b]) % 255] : 0; }
  function checkBytes(data, count) {
    var gen = [1], i, j;
    for (i = 0; i < count; i++) {   // multiply the generator by (x - 2^i)
      var next = gen.concat([0]);
      for (j = 0; j < gen.length; j++) next[j + 1] ^= mul(gen[j], EXP[i]);
      gen = next;
    }
    var rem = [];
    for (i = 0; i < count; i++) rem.push(0);
    data.forEach(function (byte) {
      var factor = byte ^ rem.shift();
      rem.push(0);
      for (j = 0; j < count; j++) rem[j] ^= mul(gen[j + 1], factor);
    });
    return rem;
  }

  // ---- text -> the full run of bytes that goes into the square ----
  function codewords(bytes, v) {
    var room = dataBytes(v), bits = [];
    function push(value, n) { for (var i = n - 1; i >= 0; i--) bits.push((value >> i) & 1); }
    push(4, 4); push(bytes.length, 8);
    bytes.forEach(function (b) { push(b, 8); });
    while (bits.length % 8) bits.push(0);   // always 4 zero bits here: they finish the byte and are the standard's end mark
    var data = [];
    for (var i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (var pad = 0; data.length < room; pad++) data.push(pad % 2 ? 0x11 : 0xEC);
    var blocks = [], checks = [], at = 0;
    SIZES[v].blocks.forEach(function (b) {
      for (var n = 0; n < b[0]; n++) { var d = data.slice(at, at + b[1]); at += b[1]; blocks.push(d); checks.push(checkBytes(d, SIZES[v].ec)); }
    });
    var out = [], longest = Math.max.apply(null, blocks.map(function (b) { return b.length; }));
    for (i = 0; i < longest; i++) blocks.forEach(function (b) { if (i < b.length) out.push(b[i]); });
    for (i = 0; i < SIZES[v].ec; i++) checks.forEach(function (c) { out.push(c[i]); });
    return out;
  }

  // ---- the square ----
  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x, y) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return (x * y) % 2 + (x * y) % 3 === 0; },
    function (x, y) { return ((x * y) % 2 + (x * y) % 3) % 2 === 0; },
    function (x, y) { return ((x + y) % 2 + (x * y) % 3) % 2 === 0; }];

  function build(words, v, mask) {
    var size = 17 + 4 * v, grid = [], fixed = [], x, y;
    for (y = 0; y < size; y++) { grid.push([]); fixed.push([]); for (x = 0; x < size; x++) { grid[y].push(0); fixed[y].push(false); } }
    function set(px, py, dark) { grid[py][px] = dark ? 1 : 0; fixed[py][px] = true; }
    function finder(cx, cy) {   // the big corner square with its light border
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var px = cx + dx, py = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (px >= 0 && px < size && py >= 0 && py < size) set(px, py, d !== 2 && d !== 4);
      }
    }
    for (var i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }   // the two dotted lines
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    if (v >= 2) {   // the one small square, near the bottom right
      for (var ay = -2; ay <= 2; ay++) for (var ax = -2; ax <= 2; ax++) set(size - 7 + ax, size - 7 + ay, Math.max(Math.abs(ax), Math.abs(ay)) !== 1);
    }
    // The 15 "format" bits (level M + which mask), written twice. Level M is 00.
    var rem = mask;
    for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    var format = ((mask << 10) | rem) ^ 0x5412;
    function bit(n) { return ((format >> n) & 1) === 1; }
    for (i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
    // The data: two columns at a time from the right, snaking up and down, skipping the dotted column.
    var n = 0, total = words.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var step = 0; step < size; step++) {
        for (var j = 0; j < 2; j++) {
          x = right - j;
          var upward = ((right + 1) & 2) === 0;
          y = upward ? size - 1 - step : step;
          if (fixed[y][x]) continue;
          var dark = n < total && ((words[n >> 3] >> (7 - (n & 7))) & 1) === 1;
          n++;
          grid[y][x] = (dark !== MASKS[mask](x, y)) ? 1 : 0;
        }
      }
    }
    return grid;
  }

  // The standard's score for how hard a square is to read (lower is better). Four rules.
  function penalty(grid) {
    var h = grid.length, w = grid[0].length, score = 0, x, y, dark = 0;
    function runs(get, lines, len) {
      for (var a = 0; a < lines; a++) {
        var run = 1;
        for (var b = 1; b <= len; b++) {
          if (b < len && get(a, b) === get(a, b - 1)) run++;
          else { if (run >= 5) score += 3 + (run - 5); run = 1; }
        }
        for (b = 0; b + 11 <= len; b++) {   // the corner-square look-alike: 1011101 with four light cells on one side
          var s = '';
          for (var k = 0; k < 11; k++) s += get(a, b + k);
          if (s === '10111010000' || s === '00001011101') score += 40;
        }
      }
    }
    runs(function (a, b) { return grid[a][b]; }, h, w);
    runs(function (a, b) { return grid[b][a]; }, w, h);
    for (y = 0; y + 1 < h; y++) for (x = 0; x + 1 < w; x++) {
      var c = grid[y][x];
      if (c === grid[y][x + 1] && c === grid[y + 1][x] && c === grid[y + 1][x + 1]) score += 3;
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) dark += grid[y][x];
    var total = w * h, steps = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    return score + Math.max(0, steps) * 10;
  }

  // text -> rows of 0 (light) and 1 (dark). mask is for the tests; leave it out and the best one is picked.
  function matrix(text, mask) {
    var bytes = utf8(text), v = 1;
    if (!bytes.length) throw new Error('qr: nothing to make a code from');
    while (v <= 6 && bytes.length > dataBytes(v) - 2) v++;   // 2 bytes go on the "plain text" mark and the length
    if (v > 6) throw new Error('qr: the text is too long for the code sizes we make (106 bytes at most)');
    var words = codewords(bytes, v);
    if (mask !== undefined) return build(words, v, mask);
    var best = null, bestScore = Infinity;
    for (var m = 0; m < 8; m++) {
      var g = build(words, v, m), s = penalty(g);
      if (s < bestScore) { best = g; bestScore = s; }
    }
    return best;
  }

  return { matrix: matrix, penalty: penalty };
})();

if (typeof module !== 'undefined') module.exports = QR;
