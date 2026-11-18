// test-png.js - png.js makes a two-colour PNG from a grid of 0s and 1s. The checker here is Node's own zlib
// (a different maker's code): it checks every chunk's CRC and unpacks the picture data, then we compare pixels.
// Run:  node --test test-png.js
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const PNG = require('./png.js');

// Reads a PNG the slow, plain way. Gives { width, height, depth, type, palette: [[r,g,b]], pixels: [[index]] }.
function readPng(bytes) {
  const b = Buffer.from(bytes);
  assert.deepStrictEqual([...b.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
  let at = 8, out = { chunks: [] }, idat = [];
  while (at < b.length) {
    const len = b.readUInt32BE(at), type = b.toString('latin1', at + 4, at + 8), data = b.subarray(at + 8, at + 8 + len);
    assert.strictEqual(b.readUInt32BE(at + 8 + len), zlib.crc32(b.subarray(at + 4, at + 8 + len)), 'CRC of chunk ' + type);
    out.chunks.push(type);
    if (type === 'IHDR') { out.width = data.readUInt32BE(0); out.height = data.readUInt32BE(4); out.depth = data[8]; out.type = data[9]; out.rest = [data[10], data[11], data[12]]; }
    if (type === 'PLTE') { out.palette = []; for (let i = 0; i < data.length; i += 3) out.palette.push([data[i], data[i + 1], data[i + 2]]); }
    if (type === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = 1 + Math.ceil(out.width * out.depth / 8);
  assert.strictEqual(raw.length, stride * out.height, 'picture data is exactly height rows');
  out.pixels = [];
  for (let y = 0; y < out.height; y++) {
    assert.strictEqual(raw[y * stride], 0, 'row filter 0');
    const row = [];
    for (let x = 0; x < out.width; x++) row.push(out.depth === 8 ? raw[y * stride + 1 + x] : (raw[y * stride + 1 + (x >> 3)] >> (7 - (x & 7))) & 1);
    out.pixels.push(row);
  }
  return out;
}

test('a 3 by 2 grid comes back pixel for pixel, with the two colours given', () => {
  const p = readPng(PNG.encode([[1, 0, 1], [0, 1, 0]], [[255, 255, 255], [31, 42, 48]], 1, 0));
  assert.deepStrictEqual([p.width, p.height, p.depth, p.type, p.rest], [3, 2, 1, 3, [0, 0, 0]]);
  assert.deepStrictEqual(p.chunks, ['IHDR', 'PLTE', 'IDAT', 'IEND']);
  assert.deepStrictEqual(p.palette, [[255, 255, 255], [31, 42, 48]]);
  assert.deepStrictEqual(p.pixels, [[1, 0, 1], [0, 1, 0]]);
});

test('scale makes every cell a square of that many pixels; margin adds cells of colour 0 all round', () => {
  const p = readPng(PNG.encode([[1, 0], [0, 1]], [[255, 255, 255], [0, 0, 0]], 3, 2));
  assert.deepStrictEqual([p.width, p.height], [(2 + 4) * 3, (2 + 4) * 3]);
  const cell = (cx, cy) => { const s = new Set(); for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) s.add(p.pixels[cy * 3 + y][cx * 3 + x]); return [...s]; };
  for (let cy = 0; cy < 6; cy++) for (let cx = 0; cx < 6; cx++) {
    const inside = cx >= 2 && cx < 4 && cy >= 2 && cy < 4;
    assert.deepStrictEqual(cell(cx, cy), [inside ? [[1, 0], [0, 1]][cy - 2][cx - 2] : 0], 'cell ' + cx + ',' + cy);
  }
});

test('a width that is not a multiple of 8 keeps its last column', () => {
  const grid = [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]];
  assert.deepStrictEqual(readPng(PNG.encode(grid, [[9, 9, 9], [200, 0, 0]], 1, 0)).pixels, grid);
});

test('a big picture (more than one 65535-byte block of data) still unpacks right', () => {
  const grid = [];
  for (let y = 0; y < 512; y++) { const row = []; for (let x = 0; x < 512; x++) row.push(((x * 7 + y * 13) % 5 === 0) ? 1 : 0); grid.push(row); }
  const bytes = PNG.encode(grid, [[255, 255, 255], [0, 0, 0]], 2, 0);
  const p = readPng(bytes);
  assert.strictEqual(p.width, 1024);
  assert.ok(p.height * (1 + 128) > 65535, 'the test really crosses the block limit');
  for (let y = 0; y < 1024; y += 37) for (let x = 0; x < 1024; x += 41) assert.strictEqual(p.pixels[y][x], grid[y >> 1][x >> 1]);
  assert.ok(bytes.every(function (v) { return v === (v & 255); }), 'every byte is 0 to 255');
});

test('rgb reads a colour like #1F2A30 (any case, with or without the hash); nonsense gives null', () => {
  assert.deepStrictEqual(PNG.rgb('#1F2A30'), [31, 42, 48]);
  assert.deepStrictEqual(PNG.rgb('ff00aa'), [255, 0, 170]);
  assert.strictEqual(PNG.rgb('blue'), null);
  assert.strictEqual(PNG.rgb('#12345'), null);
  assert.strictEqual(PNG.rgb(''), null);
});

test('a grid with no rows, or rows of different lengths, is refused', () => {
  assert.throws(() => PNG.encode([], [[0, 0, 0], [1, 1, 1]], 1, 0), /grid/);
  assert.throws(() => PNG.encode([[1, 0], [1]], [[0, 0, 0], [1, 1, 1]], 1, 0), /grid/);
});

// 18 Nov: the bell's edges were jagged on the iPhone (two colours only). More than two colours = 8 bits a pixel,
// so edges can be shaded between the owner's colour and white.
test('more than two colours: 8 bits a pixel, every cell keeps its colour number, and the palette is all the colours', () => {
  const pal = [[10, 20, 30], [40, 50, 60], [70, 80, 90], [255, 255, 255]];
  const grid = [[0, 1, 2, 3], [3, 2, 1, 0]];
  const p = readPng(PNG.encode(grid, pal, 2, 1));
  assert.equal(p.depth, 8);
  assert.deepEqual(p.palette, pal);
  assert.equal(p.width, (4 + 2) * 2);
  assert.deepEqual(p.pixels[2].slice(2, 10), [0, 0, 1, 1, 2, 2, 3, 3]);
  assert.deepEqual(p.pixels[0], new Array(12).fill(0), 'the margin is colour 0');
});

test('a cell number that has no colour is refused', () => {
  assert.throws(() => PNG.encode([[0, 3]], [[0, 0, 0], [1, 1, 1], [2, 2, 2]], 1, 0), /colour/);
});
