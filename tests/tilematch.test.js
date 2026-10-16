// Tile recognition checks against the league's reference photos in image/.
// Needs `npm i --no-save jpeg-js` and the photos; skips quietly when either is missing (e.g. CI).
const fs = require('fs'), path = require('path'), assert = require('assert');
const dir = path.join(__dirname, '..', 'image');
let jpeg; try { jpeg = require('jpeg-js'); } catch { console.log('tilematch: jpeg-js not installed, skipping'); process.exit(0); }
if (!fs.existsSync(dir)) { console.log('tilematch: image/ not present, skipping'); process.exit(0); }
const TM = require('../public/tilematch.js');
const refs = TM.loadRefs(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'refs.json'), 'utf8')));
const W = TM.weightsFrom(refs);
const load = m => jpeg.decode(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(f => f.includes(m)))), { useTArray: true });
const nine = s => Array.from({ length: 9 }, (_, i) => (i + 1) + s);
const HONORS = ['E', 'S', 'W', 'N', 'bf1', 'bf2', 'bf3', 'bf4', 'rf1', 'rf2', 'rf3', 'rf4', 'GD', 'WD', 'RD'];

// each photo is found tile by tile, in order, and every tile reads back as itself
for (const [m, codes] of [['10.06.29 (1)', HONORS], ['10.06.29 (2)', nine('p')], ['10.06.30 (1)', nine('m')], ['10.06.30.jpeg', nine('s')]]) {
  const { tiles } = TM.recognizeTiles(load(m), refs, W);
  assert.deepStrictEqual(tiles.map(t => t.code), codes, m);
  assert(tiles.every(t => t.ok), m + ': every tile should be confident');
}

// a different photo of the same honors/flowers, matched with only the OTHER photo's references
const marble = refs.slice(0, 15), zoom = refs.slice(15, 29), suits = refs.slice(29);
const cross = TM.recognizeTiles(load('10.06.29 (1)'), [...zoom, ...suits], TM.weightsFrom([...zoom, ...suits])).tiles;
const right = cross.filter((t, i) => t.code === HONORS[i]).length;
assert(right >= 14, `cross-photo: ${right}/15`);                       // 14 of 15: red dragon only exists in one photo
assert(cross.filter(t => t.ok && t.code !== HONORS[cross.indexOf(t)]).length === 0, 'no confident misreads');
// stacked rows in one photo (3 + 6 + 6 tiles, rows touching), also after the JPEG re-encode the app does
for (const buf of [fs.readFileSync(path.join(__dirname, 'fixtures', 'stacked-rows.jpeg')), null]) {
  const raw = jpeg.decode(buf || fs.readFileSync(path.join(__dirname, 'fixtures', 'stacked-rows.jpeg')), { useTArray: true });
  const img = buf ? raw : jpeg.decode(jpeg.encode(raw, 85).data, { useTArray: true });
  const codes = TM.recognizeTiles(img, refs, W).tiles.map(t => t.code);
  assert.deepStrictEqual(codes, ['4s', '4s', 'rf4', 'N', 'N', 'N', 'W', 'W', 'W', '1m', '1m', '1m', '5s', '5s', '5s'], 'stacked rows' + (buf ? '' : ' (re-encoded)'));
}
console.log('tilematch tests passed');
