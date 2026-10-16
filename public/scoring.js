/* J2 Mahjong League scoring engine (Panduan Skor, Oktober 2026).
 * Pure functions, no DOM. Works in browser (window.J2) and Node (module.exports).
 *
 * Tile codes
 *   suits:   1m..9m (萬 characters), 1p..9p (circles), 1s..9s (bamboo)
 *   winds:   E S W N
 *   dragons: RD (中 red), GD (發 green), WD (白 white)
 *   flowers: bf1..bf4 (black numeral 梅蘭菊竹), rf1..rf4 (red numeral 春夏秋冬)
 * The designated joker tile: every copy of it is always a joker. If it is a flower, all four flowers of its set
 * (bf1..bf4 or rf1..rf4) are jokers and also still score as flowers.
 */
(function (root) {
  const KINDS = [];
  for (const s of ['m', 'p', 's']) for (let n = 1; n <= 9; n++) KINDS.push(n + s);
  KINDS.push('E', 'S', 'W', 'N', 'RD', 'GD', 'WD');
  const IDX = Object.fromEntries(KINDS.map((k, i) => [k, i]));
  const FLOWERS = ['bf1', 'bf2', 'bf3', 'bf4', 'rf1', 'rf2', 'rf3', 'rf4'];
  const WINDS = ['E', 'S', 'W', 'N'];

  const isSuit = i => i < 27;
  const suitOf = i => Math.floor(i / 9);
  const numOf = i => (i % 9) + 1;
  const isWind = i => i >= 27 && i <= 30;
  const isDragon = i => i >= 31;
  const isHonor = i => i >= 27;
  const isTerminal = i => isSuit(i) && (numOf(i) === 1 || numOf(i) === 9);
  const isFlower = c => FLOWERS.includes(c);

  // ---------- meld helpers ----------
  const meldTiles = m => {
    if (m.type === 'chow') return [m.k, m.k + 1, m.k + 2];
    const n = m.type === 'kong' ? 4 : m.type === 'pair' ? 2 : 3;
    return Array(n).fill(m.k);
  };
  const isTriplet = m => m.type === 'pong' || m.type === 'kong';
  const chowStarts = [];
  for (let s = 0; s < 3; s++) for (let n = 0; n < 7; n++) chowStarts.push(s * 9 + n);

  // Options for one exposed group the user laid out.
  function exposedOptions(group, joker) {
    const reals = group.tiles.filter(t => t !== joker).map(t => IDX[t]);
    const j = group.tiles.length - reals.length;
    const base = { j, exposed: !group.concealedKong, visible: true, concealed: !!group.concealedKong };
    const opts = [];
    const same = reals.every(r => r === reals[0]);
    if (group.tiles.length === 4) {
      if (reals.length === 0) KINDS.forEach((_, k) => opts.push({ ...base, type: 'kong', k }));
      else if (same) opts.push({ ...base, type: 'kong', k: reals[0] });
    } else if (group.tiles.length === 3) {
      if (reals.length === 0) {
        KINDS.forEach((_, k) => opts.push({ ...base, type: 'pong', k }));
        chowStarts.forEach(k => opts.push({ ...base, type: 'chow', k }));
      } else {
        if (same) opts.push({ ...base, type: 'pong', k: reals[0] });
        const distinct = new Set(reals).size === reals.length;
        if (distinct && reals.every(r => isSuit(r) && suitOf(r) === suitOf(reals[0]))) {
          for (const s of chowStarts) {
            if (suitOf(s) !== suitOf(reals[0])) continue;
            if (reals.every(r => r >= s && r <= s + 2)) opts.push({ ...base, type: 'chow', k: s });
          }
        }
      }
    }
    return opts;
  }

  // All ways to split concealed real tiles + jokers into `sets` sets and `pairs` pairs.
  function decompose(counts, j, sets, pairs) {
    const out = [];
    const acc = [];
    const rec = (j, sets, pairs) => {
      if (j < 0) return;
      let i = counts.findIndex(c => c > 0);
      if (i === -1) {
        if (j !== sets * 3 + pairs * 2) return;
        // joker-only melds: enumerate what they represent
        const rest = [];
        if (sets === 1 && pairs === 0) {
          KINDS.forEach((_, k) => rest.push([{ type: 'pong', k, j: 3, concealed: true }]));
          chowStarts.forEach(k => rest.push([{ type: 'chow', k, j: 3, concealed: true }]));
        } else if (sets === 0 && pairs === 1) {
          KINDS.forEach((_, k) => rest.push([{ type: 'pair', k, j: 2, concealed: true }]));
        } else if (sets === 0 && pairs === 0) rest.push([]);
        else return; // more than 4 jokers would be needed
        for (const r of rest) out.push([...acc, ...r]);
        return;
      }
      const c = counts[i];
      // pair
      if (pairs > 0) {
        for (const r of [2, 1]) {
          if (r > c) continue;
          counts[i] -= r; acc.push({ type: 'pair', k: i, j: 2 - r, concealed: true });
          rec(j - (2 - r), sets, pairs - 1);
          acc.pop(); counts[i] += r;
        }
      }
      if (sets > 0) {
        // pong
        for (const r of [3, 2, 1]) {
          if (r > c) continue;
          counts[i] -= r; acc.push({ type: 'pong', k: i, j: 3 - r, concealed: true });
          rec(j - (3 - r), sets - 1, pairs);
          acc.pop(); counts[i] += r;
        }
        // chow containing i at position o
        if (isSuit(i)) {
          for (let o = 0; o < 3; o++) {
            const s = i - o;
            if (s < 0 || suitOf(s) !== suitOf(i) || numOf(s) > 7) continue;
            let used = [], jj = 0;
            for (let p = 0; p < 3; p++) {
              const t = s + p;
              if (t === i) { used.push(t); continue; }
              if (t > i && counts[t] > 0) used.push(t); else jj++;
            }
            used.forEach(t => counts[t]--);
            acc.push({ type: 'chow', k: s, j: jj, concealed: true });
            rec(j - jj, sets - 1, pairs);
            acc.pop(); used.forEach(t => counts[t]++);
          }
        }
      }
    };
    rec(j, sets, pairs);
    return out;
  }

  // ---------- flowers ----------
  function flowerItems(flowers, seatNo) {
    const b = new Set(flowers.filter(f => f.startsWith('bf')).map(f => +f[2]));
    const r = new Set(flowers.filter(f => f.startsWith('rf')).map(f => +f[2]));
    const items = [];
    if (b.size === 4 && r.size === 4) {
      items.push(it(6, 12));
      return items;
    }
    if (b.size === 4) items.push(it(4, 3));
    else if (b.has(seatNo)) items.push(it(1, 1));
    if (r.size === 4) items.push(it(5, 7));
    else for (const n of r) items.push(it(n === seatNo ? 3 : 2, n === seatNo ? 2 : 1, n === seatNo ? '' : ` (${n})`));
    return items;
  }

  // ---------- rule catalogue (names from the guide) ----------
  const RULES = {
    1: ['Bunga Hitam Sesuai Kursi', 'Black flower, own seat'],
    2: ['Bunga Merah Tidak Sesuai Kursi', 'Red flower, other seat'],
    3: ['Bunga Merah Sesuai Kursi', 'Red flower, own seat'],
    4: ['Satu Set Bunga Hitam', 'All 4 black flowers'],
    5: ['Satu Set Bunga Merah', 'All 4 red flowers'],
    6: ['Satu Set Bunga Lengkap', 'All 8 flowers'],
    7: ['Tanpa Bunga, Naga & Angin', 'No flowers, dragons or winds'],
    8: ['Joker', 'Joker'],
    9: ['Satu Set Joker — Tanpa Struktur', '4 jokers, instant win'],
    10: ['Satu Set Joker — Dengan Struktur', '4 jokers in a complete hand'],
    11: ['Tanpa Joker', 'No joker'],
    12: ['Kembar 3/4 Naga Merah', 'Red dragon pong'],
    13: ['Kembar 3/4 Naga Putih / Hijau', 'White/green dragon pong'],
    14: ['Kembar 3/4 Angin Ronde / Kursi', 'Round/seat wind pong'],
    15: ['Angin Ganda', 'Double wind pong'],
    16: ['Pasangan 2 / 8', 'Pair of 2 or 8'],
    17: ['Tangan Tertutup', 'Concealed hand'],
    18: ['Menang Sendiri', 'Self-draw'],
    19: ['Tangan Tertutup Seluruhnya', 'Fully concealed'],
    20: ['Menang dari Ekor Dinding', 'Win on replacement tile'],
    21: ['Mencuri Kembar 4', 'Robbing the kong'],
    22: ['Ubin Dinding Terakhir', 'Last wall tile'],
    23: ['Sisa Satu Ubin', 'Single wait, all sets exposed'],
    24: ['Joker sebagai Pasangan', 'Joker pair'],
    25: ['Joker sebagai Kelompok 3', 'Joker set of three'],
    26: ['Empat Deret Urut', 'All chows'],
    27: ['Empat Kelompok Kembar 3', 'Four pongs'],
    28: ['Tiga Kembar 3 Tertutup', 'Three concealed pongs'],
    29: ['Campuran Terminal', 'Mixed terminals'],
    30: ['Setengah Seragam', 'Half flush'],
    31: ['Tiga Naga Kecil', 'Small three dragons'],
    32: ['Tujuh Pasangan Umum', 'Seven pairs'],
    33: ['Tujuh Pasangan dengan Deret Urut', 'Seven pairs, sequences'],
    34: ['Tujuh Pasangan Deret Urut Sejenis', 'Seven pairs, sequences, one suit'],
    35: ['Seragam Lengkap', 'Full flush'],
    36: ['Tiga Naga Besar', 'Big three dragons'],
    37: ['Empat Angin Kecil', 'Small four winds'],
    38: ['Empat Kembar 3 Tertutup', 'Four concealed pongs'],
    39: ['Semua Naga & Angin', 'All honors'],
    40: ['Semua Terminal', 'All terminals'],
    41: ['Sembilan Gerbang', 'Nine gates'],
    42: ['Empat Angin Besar', 'Big four winds'],
    43: ['Tiga Belas Anak Yatim Piatu', 'Thirteen orphans'],
    44: ['Empat Kembar 4', 'Four kongs'],
    45: ['Tangan Surga', 'Heavenly hand'],
    46: ['Tangan Dunia', 'Earthly hand'],
    47: ['Pau-Chin', 'Pau-Chin'],
  };
  // [with joker, without joker]
  const DUAL = { 32: [10, 20], 33: [15, 25], 34: [35, 45], 35: [15, 25], 36: [20, 30], 37: [25, 35], 38: [25, 35], 39: [25, 35], 40: [25, 35], 41: [35, 45], 42: [50, 60], 43: [40, 60], 45: [25, 35], 46: [25, 35], 47: [10, 15] };
  function it(no, pts, suffix = '') {
    return { no, name: RULES[no][0] + suffix, en: RULES[no][1], pts };
  }
  const dual = (no, withJ) => it(no, DUAL[no][withJ ? 0 : 1]);

  // ---------- pattern checks on represented tiles ----------
  function patterns(tiles) {
    const suits = new Set(tiles.filter(isSuit).map(suitOf));
    const honors = tiles.some(isHonor);
    const suited = tiles.some(isSuit);
    return {
      allHonors: tiles.length > 0 && !suited,
      allTerminals: tiles.length > 0 && tiles.every(isTerminal),
      mixedTerminals: suited && honors && tiles.every(t => isHonor(t) || isTerminal(t)),
      fullFlush: suited && !honors && suits.size === 1,
      halfFlush: suited && honors && suits.size === 1,
      noHonors: !honors,
    };
  }

  function contextItems(ctx, withJ) {
    const x = ctx.extras || {};
    const items = [];
    if (x.replacement) items.push(it(20, 2));
    if (x.robKong) items.push(it(21, 2));
    if (x.lastTile) items.push(it(22, 3));
    if (x.heavenly) items.push(dual(45, withJ));
    if (x.earthly) items.push(dual(46, withJ));
    if (x.pauChin) items.push(dual(47, withJ));
    return items;
  }
  function concealmentItems(concealedHand, selfDraw) {
    if (concealedHand && selfDraw) return [it(19, 3)];
    const a = [];
    if (concealedHand) a.push(it(17, 1));
    if (selfDraw) a.push(it(18, 1));
    return a;
  }
  function jokerItems(J) {
    if (J === 4) return [it(10, 25)];
    if (J > 0) return [{ ...it(8, J), name: RULES[8][0] + ` ×${J}` }];
    return [it(11, 2)];
  }

  // ---------- standard hand (4 sets + pair) ----------
  function scoreStandard(melds, h, ctx) {
    const { J, flowers, concealedCounts } = h;
    const withJ = J > 0;
    const sets = melds.filter(m => m.type !== 'pair');
    const pair = melds.find(m => m.type === 'pair');
    const items = [...flowerItems(flowers, ctx.seatNo), ...jokerItems(J)];
    const rep = melds.flatMap(meldTiles);
    const P = patterns(rep);
    const seatW = 27 + ctx.seatWind, roundW = 27 + ctx.roundWind;
    const trip = sets.filter(isTriplet);
    const dragonTrips = trip.filter(m => isDragon(m.k));
    const windTrips = trip.filter(m => isWind(m.k));
    const kongs = sets.filter(m => m.type === 'kong');
    const concealedTrips = trip.filter(m => m.concealed);
    const exposedCount = h.exposedCount;
    const concealedHand = melds.every(m => !m.exposed);

    if (!flowers.length && P.noHonors) items.push(it(7, 2));

    // dragons
    const small3 = dragonTrips.length === 2 && pair && isDragon(pair.k);
    const big3 = dragonTrips.length === 3;
    if (small3) items.push(it(31, 7));
    else for (const m of dragonTrips) items.push(m.k === IDX.RD ? it(12, 2) : it(13, 1, m.k === IDX.WD ? ' (putih)' : ' (hijau)'));
    if (big3) items.push(dual(36, withJ));

    // winds
    const big4 = windTrips.length === 4;
    const small4 = windTrips.length === 3 && pair && isWind(pair.k);
    for (const m of windTrips) {
      if (m.k === seatW && m.k === roundW) items.push(it(15, 2));
      else if (m.k === seatW || m.k === roundW) items.push(it(14, 1, ` (${WINDS[m.k - 27]})`));
    }
    if (big4) items.push(dual(42, withJ));
    else if (small4) items.push(dual(37, withJ));

    // pair
    const jokerPair = pair && pair.j === 2;
    if (jokerPair) items.push(it(24, 10));
    else if (pair && isSuit(pair.k) && (numOf(pair.k) === 2 || numOf(pair.k) === 8)) items.push(it(16, 1));
    for (const m of sets) if (m.j >= 3) items.push(it(25, 20));

    // concealment / way of winning
    items.push(...concealmentItems(concealedHand, ctx.selfDraw));
    const fourKongs = kongs.length === 4;
    if (!fourKongs && exposedCount === 4) items.push(it(23, 3));

    // patterns
    if (sets.every(m => m.type === 'chow') && pair && !isDragon(pair.k) && pair.k !== seatW && pair.k !== roundW) items.push(it(26, 2));
    const four4 = concealedTrips.length === 4;
    if (fourKongs) items.push(it(44, 60));
    else if (four4) items.push(dual(38, withJ));
    else {
      if (trip.length === 4 && !big4) items.push(it(27, 3));
      if (concealedTrips.length >= 3) items.push(it(28, 3));
    }
    if (P.allHonors) items.push(dual(39, withJ));
    else if (P.allTerminals) items.push(dual(40, withJ));
    else if (P.mixedTerminals) items.push(it(29, 3));
    // nine gates: concealed, one suit, 1112345678999 + 1 (jokers fill gaps)
    const nine = concealedHand && h.exposedCount === 0 && nineGates(concealedCounts, J);
    if (nine) items.push(dual(41, withJ));
    else if (P.fullFlush) items.push(dual(35, withJ));
    if (P.halfFlush) items.push(it(30, 3));

    items.push(...contextItems(ctx, withJ));

    // KV.3 trigger: special hand won on a discard with enough sets already exposed
    const open = sets.filter(m => m.exposed);
    let kv3 = false;
    if (!ctx.selfDraw) {
      if (big3 && open.filter(m => isDragon(m.k) && isTriplet(m)).length >= 2) kv3 = true;
      if (P.fullFlush && open.length >= 3) kv3 = true;
      if ((small4 || big4) && open.filter(m => isWind(m.k)).length >= 3) kv3 = true;
      if (P.allHonors && open.length >= 3) kv3 = true;
      if (P.allTerminals && open.length >= 3) kv3 = true;
    }
    return { structure: 'standard', items, kv3, melds };
  }

  function nineGates(counts, J) {
    const reals = counts.reduce((a, b) => a + b, 0);
    if (reals + J !== 14) return false;
    const used = counts.map((c, i) => (c ? i : -1)).filter(i => i >= 0);
    if (!used.length || !used.every(i => isSuit(i) && suitOf(i) === suitOf(used[0]))) return false;
    const s = suitOf(used[0]) * 9;
    const need = [3, 1, 1, 1, 1, 1, 1, 1, 3];
    let deficit = 0, extra = 0;
    for (let n = 0; n < 9; n++) {
      const c = counts[s + n];
      if (c < need[n]) deficit += need[n] - c; else extra += c - need[n];
    }
    return extra <= 1 && deficit <= J;
  }

  // ---------- seven pairs ----------
  function scoreSevenPairs(h, ctx) {
    const { counts, J, flowers } = h;
    let singles = 0;
    const pairKinds = [];
    counts.forEach((c, k) => {
      for (let i = 0; i < Math.floor(c / 2); i++) pairKinds.push(k);
      if (c % 2) { singles++; pairKinds.push(k); }
    });
    const free = J - singles;
    if (free < 0 || free % 2) return null;
    const wild = free / 2;
    if (pairKinds.length + wild !== 7) return null;
    const withJ = J > 0;
    const seatW = 27 + ctx.seatWind, roundW = 27 + ctx.roundWind;

    // try to arrange pairs as two doubled chows + one pair
    let best = 0; // 32, 33 or 34
    const have = {};
    pairKinds.forEach(k => (have[k] = (have[k] || 0) + 1));
    for (const a of chowStarts) for (const b of chowStarts) {
      if (b < a) continue;
      for (let p = 0; p < 34; p++) {
        const need = {};
        [a, a + 1, a + 2, b, b + 1, b + 2, p].forEach(k => (need[k] = (need[k] || 0) + 1));
        let ok = true, missing = 0;
        for (const k in have) if ((need[k] || 0) < have[k]) { ok = false; break; }
        if (!ok) continue;
        for (const k in need) missing += need[k] - (have[k] || 0);
        if (missing !== wild) continue;
        const special = isDragon(p) || p === seatW || p === roundW;
        if (special) continue;
        const oneSuit = isSuit(p) && suitOf(a) === suitOf(b) && suitOf(p) === suitOf(a);
        best = Math.max(best, oneSuit ? 34 : 33);
      }
    }
    const no = best || 32;
    const items = [...flowerItems(flowers, ctx.seatNo), ...jokerItems(J), dual(no, withJ)];
    const P = patterns(pairKinds);
    if (!flowers.length && P.noHonors) items.push(it(7, 2));
    items.push(...concealmentItems(true, ctx.selfDraw));
    if (P.allHonors) items.push(dual(39, withJ));
    else if (P.allTerminals) items.push(dual(40, withJ));
    else if (P.mixedTerminals) items.push(it(29, 3));
    if (P.fullFlush && no !== 34) items.push(dual(35, withJ));
    if (P.halfFlush) items.push(it(30, 3));
    items.push(...contextItems(ctx, withJ));
    return { structure: 'seven-pairs', items, kv3: false, melds: [] };
  }

  // ---------- thirteen orphans ----------
  const ORPHANS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
  function scoreOrphans(h, ctx) {
    const { counts, J, flowers } = h;
    let missing = 0, dups = 0;
    for (let k = 0; k < 34; k++) {
      if (!ORPHANS.includes(k) && counts[k]) return null;
      if (ORPHANS.includes(k)) {
        if (counts[k] === 0) missing++;
        if (counts[k] > 2) return null;
        if (counts[k] === 2) dups++;
      }
    }
    if (dups > 1) return null;
    if (missing + (dups ? 0 : 1) !== J) return null;
    const withJ = J > 0;
    const items = [...flowerItems(flowers, ctx.seatNo), ...jokerItems(J), dual(43, withJ), ...concealmentItems(true, ctx.selfDraw), ...contextItems(ctx, withJ)];
    return { structure: 'thirteen-orphans', items, kv3: false, melds: [] };
  }

  // ---------- main ----------
  /**
   * hand = { joker:'5p', flowers:[...], exposed:[{tiles:[...], concealedKong:bool}], concealed:[...] }
   * ctx  = { seatWind:0-3, roundWind:0-3, seatNo:1-4, selfDraw:bool, extras:{...}, instant4J:bool,
   *          opened:[{type:'pong'|'chow', k}] sets in the concealed tiles that were already revealed }
   */
  function score(hand, ctx) {
    let joker = hand.joker;
    const flowers = (hand.flowers || []).filter(isFlower);
    let exposed = (hand.exposed || []).filter(g => g.tiles.length);
    let concealed = hand.concealed || [];
    let flowerJokers = 0; // flowers held that are jokers (a flower joker is every flower of its set of four)
    let placed = 0;       // of those, how many were put into the hand to fill a gap
    if (isFlower(joker)) {
      // A flower joker is also still a flower: every flower held scores as one. When the hand is short of tiles
      // (a flower stays in the flower row, so a winning hand is missing the tile it stands in for), the
      // flower-jokers fill the gaps: first exposed groups short of three, then the concealed hand.
      const family = joker.slice(0, 2);
      flowerJokers = new Set(flowers.filter(f => f.startsWith(family))).size;
      const tok = '#J';
      exposed = exposed.map(g => ({ ...g, tiles: g.tiles.length < 3 ? [...g.tiles, ...Array(3 - g.tiles.length).fill(tok)] : g.tiles }));
      placed = exposed.reduce((n, g, i) => n + g.tiles.filter(t => t === tok).length, 0);
      const gap = 14 - 3 * exposed.length - concealed.length;
      if (gap > 0 && placed + gap <= flowerJokers) { concealed = [...concealed, ...Array(gap).fill(tok)]; placed += gap; }
      joker = tok;
    }
    const allTiles = [...exposed.flatMap(g => g.tiles), ...concealed];
    const J = flowerJokers ? flowerJokers : allTiles.filter(t => t === joker).length;
    const withJ = J > 0;

    if (ctx.instant4J) {
      if (J < 4) return { ok: false, error: 'Instant win needs all 4 jokers in the hand.' };
      return finish({ structure: 'four-jokers-instant', items: [it(9, 10)], kv3: false, melds: [] }, ctx);
    }

    const counts = Array(34).fill(0);
    let cj = 0;
    for (const t of concealed) {
      if (t === joker) cj++;
      else if (IDX[t] === undefined) return { ok: false, error: `Unknown tile "${t}" in hand.` };
      else counts[IDX[t]]++;
    }
    const expected = 14 - 3 * exposed.length;
    if (concealed.length !== expected) {
      return { ok: false, error: `Hand has ${concealed.length} tiles; with ${exposed.length} exposed set${exposed.length === 1 ? '' : 's'} it needs ${expected}.` };
    }
    const exposedOpts = exposed.map(g => exposedOptions(g, joker));
    const bad = exposedOpts.findIndex(o => !o.length);
    if (bad >= 0) return { ok: false, error: `Exposed set ${bad + 1} is not a valid chow, pong or kong.` };

    const h = { J, flowers, counts, concealedCounts: counts.slice(), exposedCount: exposed.length };
    const candidates = [];

    const opened = ctx.opened || []; // sets inside the hand that were already opened (revealed) before the win
    if (exposed.length === 0 && !opened.length) {
      const sp = scoreSevenPairs({ ...h, J: cj }, ctx);
      if (sp) candidates.push(fixJ(sp, J));
      const to = scoreOrphans({ ...h, J: cj }, ctx);
      if (to) candidates.push(fixJ(to, J));
    }

    // cartesian product of exposed options (capped)
    let combos = [[]];
    for (const opts of exposedOpts) {
      const next = [];
      for (const c of combos) for (const o of opts) { next.push([...c, o]); if (next.length > 3000) break; }
      combos = next;
    }
    const decs = decompose(counts.slice(), cj, 4 - exposed.length, 1);
    const hOpen = { ...h, exposedCount: h.exposedCount + opened.length };
    for (const c of combos) for (const d of decs) {
      const melds = markOpened([...c, ...d], opened);
      if (melds) candidates.push(scoreStandard(melds, hOpen, ctx));
    }

    if (!candidates.length && opened.length) return { ok: false, error: 'The sets marked as opened are not in this hand. Untick them or check the tiles.' };
    if (!candidates.length) return { ok: false, error: 'These tiles do not form a winning hand. Check for misread tiles.' };
    const results = candidates.map(c => finish(c, ctx));
    results.sort((a, b) => b.total - a.total);
    if (flowerJokers) results[0].flowerJokersPlaced = placed;
    return results[0];
  }
  // Mark the player's opened sets as revealed in an arrangement; null if the arrangement has no such set.
  function markOpened(melds, opened) {
    if (!opened.length) return melds;
    const out = melds.slice();
    for (const o of opened) {
      const i = out.findIndex(m => m.type === o.type && m.k === o.k && m.concealed && !m.visible);
      if (i < 0) return null;
      out[i] = { ...out[i], exposed: true, concealed: false };
    }
    return out;
  }
  function fixJ(r, J) { // special structures use total jokers in the whole hand
    r.items = r.items.filter(i => i.no !== 8 && i.no !== 10 && i.no !== 11);
    r.items.splice(0, 0, ...jokerItems(J));
    return r;
  }
  function finish(r, ctx) {
    const kv3 = ctx.kv3Override === true ? true : ctx.kv3Override === false ? false : r.kv3;
    const base = r.items.reduce((a, b) => a + b.pts, 0);
    return { ok: true, structure: r.structure, items: r.items, melds: r.melds, base, kv3, total: kv3 ? base * 4 : base };
  }

  /** Point transfer. rule 'losers-pay': discarder pays all on a discard win; each other player pays on self-draw. */
  function settle(total, n, winner, discarder, selfDraw, rule) {
    const d = Array(n).fill(0);
    if (rule === 'tally') { d[winner] = total; return d; }
    if (selfDraw || discarder == null) {
      for (let i = 0; i < n; i++) if (i !== winner) { d[i] -= total; d[winner] += total; }
    } else { d[discarder] -= total; d[winner] += total; }
    return d;
  }

  const api = { KINDS, FLOWERS, WINDS, IDX, RULES, score, settle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.J2 = api;
})(typeof window !== 'undefined' ? window : globalThis);
