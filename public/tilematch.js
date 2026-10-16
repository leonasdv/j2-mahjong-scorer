/* Local tile recognition: finds ivory tiles in a photo and matches each one against reference
 * features built from the league's own tile set (tools/build-refs.js -> refs.json).
 * Pure functions on {width,height,data:RGBA}. Works in the browser (window.TileMatch) and Node.
 */
(function (root) {
  const FW = 24, FH = 32;            // feature grid per ink channel
  const NCH = 3, FLEN = FW * FH * NCH; // channels: black, red, green
  const DETECT_MAX = 800;            // photos are analysed at this max dimension
  const TILE_ASPECT = 0.74;          // tile width / height
  const CANON_W = 30, CANON_H = 40;  // every tile is reduced to this size before its ink is classified

  /* ---------- pixel helpers ---------- */
  function downscale(img, maxDim) {
    const s = Math.min(1, maxDim / Math.max(img.width, img.height));
    if (s === 1) return { width: img.width, height: img.height, data: img.data };
    const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
    return resizeBox({ width: img.width, height: img.height, data: img.data }, w, h);
  }
  // Area-average resize (box filter).
  function resizeBox(src, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    const sx = src.width / w, sy = src.height / h;
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
        let r = 0, g = 0, b = 0, n = 0;
        for (let yy = y0; yy < y1 && yy < src.height; yy++)
          for (let xx = x0; xx < x1 && xx < src.width; xx++) {
            const i = (yy * src.width + xx) * 4; r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; n++;
          }
        const o = (y * w + x) * 4; n = n || 1;
        out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
      }
    }
    return { width: w, height: h, data: out };
  }
  function crop(img, x0, y0, x1, y1) {
    const w = x1 - x0, h = y1 - y0, out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * img.width + x0 + x) * 4, o = (y * w + x) * 4;
      out[o] = img.data[i]; out[o + 1] = img.data[i + 1]; out[o + 2] = img.data[i + 2]; out[o + 3] = 255;
    }
    return { width: w, height: h, data: out };
  }
  // k quarter turns counter-clockwise (1 = right edge becomes top).
  function rotate(c, k) {
    k = ((k % 4) + 4) % 4;
    if (k === 0) return c;
    const w = k === 2 ? c.width : c.height, h = k === 2 ? c.height : c.width;
    const out = new Uint8ClampedArray(w * h * 4);
    for (let oy = 0; oy < h; oy++) for (let ox = 0; ox < w; ox++) {
      let sx, sy;
      if (k === 1) { sx = c.width - 1 - oy; sy = ox; }
      else if (k === 3) { sx = oy; sy = c.height - 1 - ox; }
      else { sx = c.width - 1 - ox; sy = c.height - 1 - oy; }
      const i = (sy * c.width + sx) * 4, o = (oy * w + ox) * 4;
      out[o] = c.data[i]; out[o + 1] = c.data[i + 1]; out[o + 2] = c.data[i + 2]; out[o + 3] = 255;
    }
    return { width: w, height: h, data: out };
  }

  /* ---------- tile detection ---------- */
  // Tiles are ivory: bright and not warm. Table surfaces (wood, marble, cloth) are warmer or darker.
  function tileMask(img) {
    const { width: w, height: h, data } = img, n = w * h;
    const lum = new Uint8Array(n), hist = new Float32Array(52);
    for (let p = 0; p < n; p++) {
      const v = (data[p * 4] * 3 + data[p * 4 + 1] * 6 + data[p * 4 + 2]) / 10 | 0; lum[p] = v;
      if (data[p * 4] - data[p * 4 + 2] < 14 && v >= 100) hist[v / 5 | 0]++;
    }
    const minBright = Math.max(105, ivoryFloor(hist));
    const mask = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      const r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2];
      mask[p] = (r - b) < 14 && Math.min(r, g, b) > minBright ? 1 : 0;
    }
    return mask;
  }
  // Lowest brightness still counted as ivory. Tiles are the brightest non-warm thing in the photo; if a
  // cooler shadow forms its own clearly lower hump, the threshold goes in the valley between them.
  function ivoryFloor(hist) {
    const sm = Float32Array.from(hist, (_, i) => (hist[i - 1] ?? 0) + hist[i] + (hist[i + 1] ?? 0));
    const top = Math.max(...sm); if (!top) return 0;
    let peak = -1; for (let i = sm.length - 2; i >= 20; i--) if (sm[i] >= top * 0.25 && sm[i] >= sm[i - 1] && sm[i] >= sm[i + 1]) { peak = i; break; }
    if (peak < 0) return 0;
    for (let i = peak - 7; i >= 20; i--) { // a lower hump at least 35 brightness units away
      if (sm[i] >= top * 0.25 && sm[i] >= sm[i - 1] && sm[i] >= sm[i + 1]) {
        let vi = i, vv = Infinity; for (let j = i; j <= peak; j++) if (sm[j] < vv) { vv = sm[j]; vi = j; }
        if (vv < Math.min(sm[i], sm[peak]) * 0.6) return vi * 5 * 0.94;
      }
    }
    return peak * 5 * 0.75;
  }
  function label(mask, w, h) {
    const lab = new Int32Array(w * h), stack = []; let next = 0; const comps = [];
    for (let s = 0; s < w * h; s++) {
      if (!mask[s] || lab[s]) continue;
      next++; let area = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
      lab[s] = next; stack.push(s);
      while (stack.length) {
        const p = stack.pop(), x = p % w, y = (p - x) / w; area++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = next; stack.push(p - 1); }
        if (x < w - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = next; stack.push(p + 1); }
        if (y > 0 && mask[p - w] && !lab[p - w]) { lab[p - w] = next; stack.push(p - w); }
        if (y < h - 1 && mask[p + w] && !lab[p + w]) { lab[p + w] = next; stack.push(p + w); }
      }
      comps.push({ id: next, area, x0, y0, x1: x1 + 1, y1: y1 + 1 });
    }
    return { lab, comps };
  }
  // Ink inside a tile is not "white", so fill every hole in the mask: a tile becomes a solid shape and the
  // seams between tiles (which open to the outside) stay as cuts.
  function morph(m, w, h, grow) { // 3x3 dilate (grow) or erode
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let hit = grow ? 0 : 1;
      for (let dy = -1; dy <= 1 && (grow ? !hit : hit); dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, v = xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : m[yy * w + xx];
        if (grow ? v : !v) { hit = grow ? 1 : 0; break; }
      }
      out[y * w + x] = hit;
    }
    return out;
  }
  // Opening: drops specks and thin strands (the weave of a light fabric table) but keeps tile-sized bodies.
  function open(m, w, h, n) {
    for (let i = 0; i < n; i++) m = morph(m, w, h, false);
    for (let i = 0; i < n; i++) m = morph(m, w, h, true);
    return m;
  }
  function flood(blocked, w, h) { // everything reachable from the border without crossing `blocked`
    const outside = new Uint8Array(w * h), st = [];
    const push = p => { if (!blocked[p] && !outside[p]) { outside[p] = 1; st.push(p); } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (st.length) {
      const p = st.pop(), x = p % w;
      if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (p >= w) push(p - w); if (p < w * (h - 1)) push(p + w);
    }
    return outside;
  }
  function fillHoles(mask, w, h) {
    // Anything not reachable from outside is ink inside a tile. Seams between tiles open to the outside, so
    // they stay cuts. A nick in a tile's rim would let the outside leak in, so thick ink is also recovered
    // from a flood through a slightly grown mask.
    const outside = flood(mask, w, h);
    let grown = mask; for (let i = 0; i < 2; i++) grown = morph(grown, w, h, true);
    const out2 = flood(grown, w, h);
    let core = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) core[i] = !out2[i] && !grown[i] ? 1 : 0;
    for (let i = 0; i < 2; i++) core = morph(core, w, h, true);
    const out = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) out[i] = mask[i] || !outside[i] || core[i] ? 1 : 0; return out;
  }
  // Tiles sit in straight rows. Find the tilt (degrees) that makes the row/column edges sharpest.
  function estimateTilt(mask, w, h) {
    const pts = []; const step = 2;
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (mask[y * w + x]) pts.push(x, y);
    const diag = Math.ceil(Math.hypot(w, h)), score = deg => {
      const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
      const rows = new Float32Array(2 * diag), cols = new Float32Array(2 * diag);
      for (let i = 0; i < pts.length; i += 2) {
        rows[Math.round((-pts[i] * s + pts[i + 1] * c) / step) + diag]++;
        cols[Math.round((pts[i] * c + pts[i + 1] * s) / step) + diag]++;
      }
      let sc = 0; for (let i = 1; i < rows.length; i++) { sc += (rows[i] - rows[i - 1]) ** 2 + (cols[i] - cols[i - 1]) ** 2; }
      return sc;
    };
    let best = 0, bs = score(0);
    for (let d = -12; d <= 12; d += 1) { const v = score(d); if (v > bs * 1.02) { bs = v; best = d; } }
    for (const d of [-0.5, 0.5]) { const v = score(best + d); if (v > bs) { bs = v; best += d; } }
    return best;
  }
  function rotateTilt(img, deg) { // rotate about the centre, same canvas size
    const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), { width: w, height: h } = img;
    const out = new Uint8ClampedArray(w * h * 4), cx = w / 2, cy = h / 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      const sx = Math.round(cx + dx * c - dy * s), sy = Math.round(cy + dx * s + dy * c), o = (y * w + x) * 4;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) { out[o + 3] = 255; continue; }
      const i = (sy * w + sx) * 4; out[o] = img.data[i]; out[o + 1] = img.data[i + 1]; out[o + 2] = img.data[i + 2]; out[o + 3] = 255;
    }
    return { width: w, height: h, data: out };
  }
  // Cut a blob where its row/column profile collapses: the seam between two tiles.
  function xyCut(lab, w, id, box, minSide, out) {
    const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    const colP = new Float32Array(bw), rowP = new Float32Array(bh);
    for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++)
      if (lab[y * w + x] === id) { colP[x - box.x0]++; rowP[y - box.y0]++; }
    const seam = (prof, len) => {
      const edge = Math.floor(minSide * 0.5), k = Math.max(3, Math.floor(minSide * 0.6));
      let mx = 0; for (const v of prof) if (v > mx) mx = v;
      const sm = Float32Array.from(prof, (_, i) => ((prof[i - 1] ?? prof[i]) + prof[i] + (prof[i + 1] ?? prof[i])) / 3);
      let best = null;
      for (let i = edge; i < len - edge; i++) {
        let l = 0, r = 0;
        for (let d = 0; d <= k; d++) { l = Math.max(l, sm[i - d] ?? 0); r = Math.max(r, sm[i + d] ?? 0); }
        const plateau = Math.min(l, r);
        if (plateau < mx * 0.3) continue;
        const depth = 1 - sm[i] / plateau;
        if (depth >= 0.07 && (!best || depth > best.depth)) best = { mid: i, depth };
      }
      return best;
    };
    const cx = bw >= minSide * 2 ? seam(colP, bw) : null, cy = bh >= minSide * 2 ? seam(rowP, bh) : null;
    const pick = cx && cy ? (cx.depth >= cy.depth ? ['x', cx] : ['y', cy]) : cx ? ['x', cx] : cy ? ['y', cy] : null;
    if (!pick) { out.push(box); return; }
    const [axis, c] = pick;
    const parts = axis === 'x'
      ? [{ ...box, x1: box.x0 + c.mid }, { ...box, x0: box.x0 + c.mid }]
      : [{ ...box, y1: box.y0 + c.mid }, { ...box, y0: box.y0 + c.mid }];
    for (const p of parts) {
      let x0 = p.x1, y0 = p.y1, x1 = p.x0, y1 = p.y0; // tighten to the blob's own pixels
      for (let y = p.y0; y < p.y1; y++) for (let x = p.x0; x < p.x1; x++)
        if (lab[y * w + x] === id) { if (x < x0) x0 = x; if (x >= x1) x1 = x + 1; if (y < y0) y0 = y; if (y >= y1) y1 = y + 1; }
      if (x1 > x0 && y1 > y0) xyCut(lab, w, id, { x0, y0, x1, y1 }, minSide, out);
    }
  }
  function median(a) { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; }

  // Returns tile boxes in reading order, plus the scaled image they refer to.
  function findTiles(img, opts) {
    if (opts && opts.open != null) return findTilesWith(img, opts.open);
    // A smooth table needs no cleaning; a textured one (fabric weave) shatters into dozens of specks, so
    // when that happens the mask is opened progressively harder.
    let res;
    for (const n of [0, 2, 3]) { res = findTilesWith(img, n); if (res.boxes.length <= 24) break; }
    return res;
  }
  function findTilesWith(img, OPEN) {
    let small = downscale(img, DETECT_MAX), { width: w, height: h } = small;
    let filled = fillHoles(open(tileMask(small), w, h, OPEN), w, h);
    const tilt = estimateTilt(filled, w, h);
    if (Math.abs(tilt) >= 0.5) { small = rotateTilt(small, tilt); filled = fillHoles(open(tileMask(small), w, h, OPEN), w, h); }
    const { lab, comps } = label(filled, w, h);
    const minArea = w * h * 0.0015;
    const big = comps.filter(c => c.area >= minArea);
    if (!big.length) return { image: small, boxes: [] };
    const biggest = Math.max(...big.map(c => c.area));
    const minSide = Math.max(8, Math.sqrt(biggest) * 0.12);
    let boxes = [];
    for (const c of big) xyCut(lab, w, c.id, { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 }, minSide, boxes);
    boxes = boxes.filter(b => inkFraction(small, b) >= 0.04); // drop shadows and bare table
    if (!boxes.length) return { image: small, boxes: [] };
    // Typical tile size = median of the pieces; a piece that is a whole number of tiles (no visible seam) is divided.
    const dim = b => [b.x1 - b.x0, b.y1 - b.y0];
    const L = median(boxes.map(b => Math.max(...dim(b)))), Sd = median(boxes.map(b => Math.min(...dim(b))));
    boxes = boxes.filter(b => (b.x1 - b.x0) * (b.y1 - b.y0) >= Math.max(minArea, L * Sd * 0.35));
    // A tile whose big ink block cut it in two: join halves that line up and together are one tile.
    const areaOf = b => (b.x1 - b.x0) * (b.y1 - b.y0), tileArea = L * Sd;
    for (let again = true; again;) {
      again = false;
      outer: for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], c = boxes[j];
        if (areaOf(a) > tileArea * 0.7 || areaOf(c) > tileArea * 0.7) continue;
        const u = { x0: Math.min(a.x0, c.x0), y0: Math.min(a.y0, c.y0), x1: Math.max(a.x1, c.x1), y1: Math.max(a.y1, c.y1) };
        const [uw, uh] = dim(u), fits = (uw <= Sd * 1.3 && uh <= L * 1.3) || (uw <= L * 1.3 && uh <= Sd * 1.3);
        if (fits && areaOf(u) <= tileArea * 1.4) { boxes.splice(j, 1); boxes[i] = u; again = true; break outer; }
      }
    }
    const split = [];
    for (const b of boxes) {
      const [bw, bh] = dim(b);
      const fit = (tw, th) => { const nx = Math.max(1, Math.round(bw / tw)), ny = Math.max(1, Math.round(bh / th)); return { nx, ny, err: Math.abs(bw / (nx * tw) - 1) + Math.abs(bh / (ny * th) - 1) }; };
      const p = fit(Sd, L), q = fit(L, Sd), f = p.err <= q.err ? p : q;
      if (f.nx * f.ny <= 1 || f.err > 0.3 || f.nx * f.ny > 24) { split.push(b); continue; }
      for (let j = 0; j < f.ny; j++) for (let i = 0; i < f.nx; i++) split.push({
        x0: b.x0 + Math.round(bw * i / f.nx), x1: b.x0 + Math.round(bw * (i + 1) / f.nx),
        y0: b.y0 + Math.round(bh * j / f.ny), y1: b.y0 + Math.round(bh * (j + 1) / f.ny) });
    }
    { // stray bits of table or shadow are much smaller than the tiles that dominate the photo
      const areas = split.map(areaOf).sort((a, b) => a - b), ref = areas[Math.floor(areas.length * 0.75)] || 0;
      for (let i = split.length - 1; i >= 0; i--) if (areaOf(split[i]) < ref * 0.45) split.splice(i, 1);
    }
    // A piece cut out of a multi-tile blob can land on bare table (a sliver of the next row widened its box).
    for (let i = split.length - 1; i >= 0; i--) if (inkFraction(small, split[i]) < 0.02) split.splice(i, 1);
    // reading order: group into rows by vertical centre, then left to right
    const th = median(split.map(b => Math.min(b.x1 - b.x0, b.y1 - b.y0)));
    split.sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
    const rows = [];
    for (const b of split) {
      const cy = (b.y0 + b.y1) / 2, r = rows.find(r => Math.abs(r.cy - cy) < th * 0.7);
      if (r) { r.items.push(b); r.cy = (r.cy * (r.items.length - 1) + cy) / r.items.length; } else rows.push({ cy, items: [b] });
    }
    rows.sort((a, b) => a.cy - b.cy);
    return { image: small, boxes: rows.flatMap(r => r.items.sort((a, b) => a.x0 - b.x0)) };
  }

  /* ---------- features ---------- */
  // Classify each pixel of an RGBA buffer as black / red / green ink (1) or ivory (0). Colours are taken
  // relative to the crop's own white level, so a dim or tinted photo still reads the same.
  function inkMaps(px, W, H) {
    const lvl = [0, 1, 2].map(c => { const v = []; for (let i = 0; i < W * H; i++) v.push(px[i * 4 + c]); v.sort((a, b) => a - b); return Math.max(60, v[Math.floor(v.length * 0.9)]); });
    const maps = [new Float32Array(W * H), new Float32Array(W * H), new Float32Array(W * H)];
    for (let i = 0; i < W * H; i++) {
      const r = px[i * 4] / lvl[0], g = px[i * 4 + 1] / lvl[1], b = px[i * 4 + 2] / lvl[2];
      const mx = Math.max(r, g, b), lum = (r + g + b) / 3;
      if (g - Math.max(r, b) > 0.06 && lum < 0.8) maps[2][i] = 1;
      else if (r - Math.max(g, b) > 0.25 && r > 0.4) maps[1][i] = 1;
      else if (mx < 0.62 && lum < 0.55) maps[0][i] = 1;
    }
    return maps;
  }
  // Share of a box that is printed ink: a real tile face has some, a patch of shadow or table has none.
  function inkFraction(image, b) {
    const body = crop(image, b.x0, b.y0, b.x1, b.y1), W = 32, H = 32, px = resizeBox(body, W, H).data;
    const m = inkMaps(px, W, H); let n = 0;
    for (let i = 0; i < W * H; i++) if (m[0][i] || m[1][i] || m[2][i]) n++;
    return n / (W * H);
  }
  // Ink maps (black, red, green) on a FWxFH grid, from an upright tile crop.
  function features(up) {
    // Every tile is first reduced to the same small size. A close-up reference has glints and hollow
    // centres (bamboo stalks) that a tile 70px wide in a group photo cannot show; low-passing both to one
    // resolution makes them look alike before ink is classified.
    const W = CANON_W, H = CANON_H;
    const inset = 0.07;
    const ix = Math.round(up.width * inset), iy = Math.round(up.height * inset);
    const body = crop(up, ix, iy, up.width - ix, up.height - iy);
    const px = resizeBox(body, W, H).data;
    const maps = inkMaps(px, W, H);
    const out = new Float32Array(FLEN);
    for (let c = 0; c < NCH; c++) {
      const m = maps[c];
      for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) { // area-average the maps onto the feature grid
        const x0 = x * W / FW, x1 = (x + 1) * W / FW, y0 = y * H / FH, y1 = (y + 1) * H / FH;
        let s = 0, wsum = 0;
        for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wgt = (Math.min(xx + 1, x1) - Math.max(xx, x0)) * (Math.min(yy + 1, y1) - Math.max(yy, y0));
          s += m[yy * W + xx] * wgt; wsum += wgt;
        }
        out[c * FW * FH + y * FW + x] = s / wsum;
      }
      blur(out, c * FW * FH);
    }
    return out;
  }
  function blur(a, off) { // 3x3 box blur in place on one channel
    const t = new Float32Array(FW * FH);
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= FW || yy >= FH) continue;
        s += a[off + yy * FW + xx]; n++;
      }
      t[y * FW + x] = s / n;
    }
    a.set(t, off);
  }
  // Weighted soft IoU over all ink maps. W emphasises the cells where tiles in the set differ from each
  // other (the numeral on a 萬 tile, not the 萬 itself), see weightsFrom(). The query is tried at small
  // offsets to absorb crop misalignment.
  function similarity(q, r, W) {
    let best = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      let mn = 0, mx = 0;
      for (let c = 0; c < NCH; c++) {
        const o = c * FW * FH;
        for (let y = 0; y < FH; y++) {
          const yy = y + dy; if (yy < 0 || yy >= FH) continue;
          for (let x = 0; x < FW; x++) {
            const xx = x + dx; if (xx < 0 || xx >= FW) continue;
            const a = q[o + yy * FW + xx], b = r[o + y * FW + x], w = W ? W[o + y * FW + x] : 1;
            if (a < b) { mn += a * w; mx += b * w; } else { mn += b * w; mx += a * w; }
          }
        }
      }
      const s = mx > 0 ? mn / mx : 0; if (s > best) best = s;
    }
    return best;
  }
  // Per-cell weights from the spread between tile classes (blurred so small shifts still line up).
  function weightsFrom(refs) {
    const byCode = new Map();
    for (const r of refs) { const a = byCode.get(r.code) || []; a.push(r.f); byCode.set(r.code, a); }
    const means = [...byCode.values()].map(list => { const m = new Float32Array(FLEN); for (const f of list) for (let i = 0; i < FLEN; i++) m[i] += f[i] / list.length; return m; });
    const mu = new Float32Array(FLEN), v = new Float32Array(FLEN);
    for (const m of means) for (let i = 0; i < FLEN; i++) mu[i] += m[i] / means.length;
    for (const m of means) for (let i = 0; i < FLEN; i++) v[i] += (m[i] - mu[i]) ** 2 / means.length;
    for (let c = 0; c < NCH; c++) blur(v, c * FW * FH);
    let mx = 0; for (const x of v) if (x > mx) mx = x;
    return Float32Array.from(v, x => 0.2 + 0.8 * Math.min(1, x / (mx * 0.5)));
  }

  /* ---------- matching ---------- */
  const ACCEPT = { score: 0.5, margin: 0.05 };
  function classify(tile, refs, W) {
    const portrait = (tile.width <= tile.height * 1.08);
    const turns = portrait ? [0, 2] : [1, 3];
    let best = null; const perCode = new Map();
    for (const k of turns) {
      const q = features(rotate(tile, k)), penalty = k === 2 ? 0.02 : 0; // upright is the likelier reading
      for (const r of refs) {
        const s = similarity(q, r.f, W) - penalty;
        if (s > (perCode.get(r.code) ?? -1)) perCode.set(r.code, s);
        if (!best || s > best.score) best = { code: r.code, score: s, turns: k };
      }
    }
    let second = 0; for (const [c, s] of perCode) if (c !== best.code && s > second) second = s;
    best.margin = best.score - second;
    best.ok = best.score >= ACCEPT.score && best.margin >= ACCEPT.margin;
    return best;
  }

  function packFeatures(f) { return Buffer.from(Uint8Array.from(f, v => Math.round(v * 255))).toString('base64'); }
  function unpackFeatures(s) {
    const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
    const out = new Float32Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) / 255; return out;
  }
  function loadRefs(json) { return json.map(r => ({ code: r.code, f: unpackFeatures(r.f) })); }

  // Cut a detected box out of the (scaled) photo as an RGBA tile.
  function tileImage(image, b) { return crop(image, b.x0, b.y0, b.x1, b.y1); }

  // Recognise every tile in a photo. Returns tiles in reading order with a confidence verdict.
  function recognizeTiles(img, refs, W, opts) {
    const { image, boxes } = findTiles(img, opts);
    return {
      image,
      tiles: boxes.map(b => ({ box: b, ...classify(tileImage(image, b), refs, W) })),
    };
  }

  const api = { FW, FH, weightsFrom, fillHoles, estimateTilt, findTiles, features, similarity, classify, recognizeTiles, tileImage, rotate, crop, resizeBox, loadRefs, packFeatures, unpackFeatures, ACCEPT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TileMatch = api;
})(typeof window !== 'undefined' ? window : globalThis);
