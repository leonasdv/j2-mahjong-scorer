// Builds public/refs.json: feature vectors for every tile face, cut from the league's reference photos in image/.
// Usage: npm i --no-save jpeg-js pngjs && node tools/build-refs.js [--sheet contact.png]
const fs = require('fs'), path = require('path'), jpeg = require('jpeg-js');
const TM = require('../public/tilematch.js');

const DIR = path.join(__dirname, '..', 'image');
const HONORS = ['E', 'S', 'W', 'N', 'bf1', 'bf2', 'bf3', 'bf4', 'rf1', 'rf2', 'rf3', 'rf4', 'GD', 'WD', 'RD'];
const nine = s => Array.from({ length: 9 }, (_, i) => (i + 1) + s);
// file -> tile codes in reading order, quarter turns needed to stand the tiles upright, tiles to skip
const PHOTOS = [
  { match: '10.06.29 (1)', codes: HONORS, turns: 0 },
  { match: '10.06.29.jpeg', codes: HONORS.slice(0, 14), turns: 0 }, // close-up sheet; its last tile bleeds into the table
  { match: '10.06.29 (2)', codes: nine('p'), turns: 1 },
  { match: '10.06.30 (1)', codes: nine('m'), turns: 1 },
  { match: '10.06.30.jpeg', codes: nine('s'), turns: 1 },
];

// one-tile close-ups (WhatsApp 15.35.xx): sorted by time, then "(n)" suffix; shot upright on a fabric table
const SINGLES = [...nine('m'), ...nine('p'), ...nine('s'), 'E', 'S', 'W', 'N', 'GD', 'WD', 'RD',
  'bf1', 'bf2', 'bf3', 'bf4', 'rf1', 'rf2', 'rf3', 'rf4'];
const singleFiles = fs.readdirSync(DIR).filter(f => / 15\.35\.\d\d/.test(f)).map(f => {
  const m = f.match(/15\.35\.(\d\d)(?: \((\d+)\))?/);
  return { f, k: +m[1] * 100 + (m[2] ? +m[2] : -1) };
}).sort((a, b) => a.k - b.k).map(x => x.f);

const refs = [], sheet = [];
if (singleFiles.length) {
  if (singleFiles.length !== SINGLES.length) throw new Error(`expected ${SINGLES.length} close-ups, found ${singleFiles.length}`);
  singleFiles.forEach((file, i) => {
    const img = jpeg.decode(fs.readFileSync(path.join(DIR, file)), { useTArray: true });
    const { image, boxes } = TM.findTiles(img, { open: 2 });
    if (boxes.length !== 1) console.warn(file, SINGLES[i], 'found', boxes.length, 'pieces');
    const b = boxes.slice().sort((p, q) => q.w * q.h - p.w * p.h)[0];
    if (!b) throw new Error(file + ': no tile found');
    const up = TM.tileImage(image, b);
    for (const ins of TM.INSETS) refs.push({ code: SINGLES[i], f: TM.packFeatures(TM.features(up, ins)) });
    sheet.push({ code: SINGLES[i], up });
  });
  console.log(singleFiles.length, 'close-ups');
}
for (const ph of PHOTOS) {
  const file = fs.readdirSync(DIR).find(f => f.includes(ph.match));
  if (!file) throw new Error('missing reference photo ' + ph.match);
  const img = jpeg.decode(fs.readFileSync(path.join(DIR, file)), { useTArray: true });
  const { image, boxes } = TM.findTiles(img);
  const need = ph.codes.length;
  if (boxes.length < need) throw new Error(`${file}: found ${boxes.length} tiles, expected ${need}`);
  ph.codes.forEach((code, i) => {
    const up = TM.rotate(TM.tileImage(image, boxes[i]), ph.turns);
    for (const ins of TM.INSETS) refs.push({ code, f: TM.packFeatures(TM.features(up, ins)) });
    sheet.push({ code, up });
  });
  console.log(file, '->', need, 'tiles');
}
fs.writeFileSync(path.join(__dirname, '..', 'public', 'refs.json'), JSON.stringify(refs));
console.log('wrote public/refs.json', refs.length, 'refs,', Math.round(JSON.stringify(refs).length / 1024) + ' KB');

const i = process.argv.indexOf('--sheet');
if (i > 0) { // contact sheet of the upright crops, to eyeball the orientation
  const { PNG } = require('pngjs'), cols = 12, cw = 60, ch = 80, rows = Math.ceil(sheet.length / cols);
  const png = new PNG({ width: cols * cw, height: rows * ch });
  sheet.forEach(({ up }, n) => {
    const t = TM.resizeBox(up, cw - 4, ch - 4), ox = (n % cols) * cw + 2, oy = Math.floor(n / cols) * ch + 2;
    for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) for (let c = 0; c < 4; c++)
      png.data[((oy + y) * png.width + ox + x) * 4 + c] = t.data[(y * t.width + x) * 4 + c];
  });
  fs.writeFileSync(process.argv[i + 1], PNG.sync.write(png));
}
