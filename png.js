// png.js - makes a two-colour PNG picture from a grid of 0s and 1s (the QR code, the plain default icon).
// No libraries and nothing from Apps Script: the picture data is stored unpacked (the page upload gzips it anyway).
// Runs in Apps Script and in Node (for the tests).
var PNG = (function () {
  'use strict';

  var TABLE = null;
  function crc32(bytes) {
    if (!TABLE) {
      TABLE = [];
      for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); TABLE.push(c >>> 0); }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = TABLE[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function adler32(bytes) {
    var a = 1, b = 0;
    for (var i = 0; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; }
    return ((b << 16) | a) >>> 0;
  }
  function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function chunk(type, data) {
    var body = [type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)].concat(data);
    return u32(data.length).concat(body, u32(crc32(body)));
  }
  // zlib wrapping with "stored" blocks: 2 header bytes, then blocks of up to 65535 bytes, then the Adler-32 check.
  function stored(raw) {
    var out = [0x78, 0x01];
    for (var at = 0; at < raw.length || at === 0; at += 65535) {
      var len = Math.min(65535, raw.length - at), last = at + len >= raw.length;
      out.push(last ? 1 : 0, len & 255, len >>> 8, (~len) & 255, ((~len) >>> 8) & 255);
      for (var i = 0; i < len; i++) out.push(raw[at + i]);
      if (last) break;
    }
    return out.concat(u32(adler32(raw)));
  }

  // '#1F2A30' -> [31, 42, 48]. Anything else -> null.
  function rgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex === undefined || hex === null ? '' : hex).trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // grid = rows of colour numbers, all the same length. colours = [[r, g, b] for 0, [r, g, b] for 1, ...].
  // Two colours = 1 bit a pixel (the QR code). More = 8 bits a pixel (18 Nov: the bell's shaded edges).
  // scale = pixels per cell. margin = cells of colour 0 added all round. Gives the PNG as a list of bytes (0 to 255).
  function encode(grid, colours, scale, margin) {
    var cellsHigh = (grid || []).length, cellsWide = cellsHigh ? grid[0].length : 0;
    if (!cellsHigh || !cellsWide || grid.some(function (r) { return r.length !== cellsWide; })) throw new Error('png: the grid must be rows of equal length');
    var depth = colours.length > 2 ? 8 : 1;
    if (grid.some(function (r) { return r.some(function (v) { return !(v >= 0 && v < colours.length); }); })) throw new Error('png: a cell has no colour');
    var width = (cellsWide + 2 * margin) * scale, height = (cellsHigh + 2 * margin) * scale, stride = Math.ceil(width * depth / 8);
    var raw = [], blank = [0];
    for (var b = 0; b < stride; b++) blank.push(0);
    function line(cells) {
      var row = blank.slice();
      for (var c = 0; c < cellsWide; c++) {
        if (!cells[c]) continue;
        for (var x = (c + margin) * scale, end = x + scale; x < end; x++) {
          if (depth === 8) row[1 + x] = cells[c]; else row[1 + (x >> 3)] |= 128 >> (x & 7);
        }
      }
      return row;
    }
    function repeat(row, times) { for (var t = 0; t < times; t++) for (var i = 0; i < row.length; i++) raw.push(row[i]); }
    repeat(blank, margin * scale);
    grid.forEach(function (cells) { repeat(line(cells), scale); });
    repeat(blank, margin * scale);
    return [137, 80, 78, 71, 13, 10, 26, 10].concat(
      chunk('IHDR', u32(width).concat(u32(height), [depth, 3, 0, 0, 0])),   // palette colour
      chunk('PLTE', colours.reduce(function (all, c) { return all.concat(c); }, [])),
      chunk('IDAT', stored(raw)),
      chunk('IEND', []));
  }

  return { encode: encode, rgb: rgb };
})();

if (typeof module !== 'undefined') module.exports = PNG;
