// Cloudflare Worker: tile-recognition proxy. Keeps the Anthropic API key off the client.
// Accepts POST {image: <base64 jpeg>, mode: 'single'|'hand'} and returns the JSON the PWA expects.
const MODEL = 'claude-sonnet-5-5';
const ALLOWED_ORIGINS = ['https://leonasdv.github.io', 'http://localhost:5173'];

const TILE_GUIDE = `Tile set guide (Indonesian J2 league set, ivory tiles, tiles may be rotated 90 degrees):
- Characters "m": black Chinese numeral on top (一 二 三 四 伍 六 七 八 九) above a red 萬. Codes 1m..9m. No Arabic numbers on these tiles.
- Circles "p": 1 to 9 round pips (the 1 is one big ornate circle). Count pips carefully: 7 has 3 diagonal + 4, 8 has two columns of four, 9 is 3x3. Codes 1p..9p.
- Bamboo "s": 1 is a bird; 2 to 9 are green sticks (some red); 8 has two zig-zag/M shapes. Count sticks. Codes 1s..9s.
- Winds: black 東 E, 南 S, 西 W, 北 N.
- Dragons: red 中 = RD, green 發 = GD, empty framed rectangle = WD.
- Flowers: BLACK numeral 1-4 with red character 梅 蘭 菊 竹 = bf1..bf4. RED numeral 1-4 with black character 春 夏 秋 冬 = rf1..rf4. Decide black vs red by the NUMERAL colour.`;

const PROMPTS = {
  single: `${TILE_GUIDE}\n\nThe photo shows ONE mahjong tile. Reply with JSON only: {"tile":"<code>"}`,
  hand: `${TILE_GUIDE}\n\nThe photo shows a player's winning mahjong hand on a table. Identify every tile face. Flowers go in "flowers". If some tiles are clearly laid apart as revealed sets of 3 or 4 (chow/pong/kong), put each such set in "groups"; put all other tiles in "hand" in left-to-right order. Ignore face-down tiles. Reply with JSON only: {"flowers":["..."],"groups":[["..."]],"hand":["..."]}`,
};

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'Origin not allowed' }, 403);

    let body;
    try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
    const { image, mode } = body;
    if (typeof image !== 'string' || !PROMPTS[mode]) return json({ error: 'Need image (base64) and mode (single|hand)' }, 400);
    if (image.length > 6_000_000) return json({ error: 'Image too large' }, 413);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
          { type: 'text', text: PROMPTS[mode] },
        ] }],
      }),
    });
    if (!res.ok) return json({ error: 'Upstream ' + res.status }, 502);
    const data = await res.json();
    const text = (data.content || []).map(c => c.text || '').join('');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return json({ error: 'No JSON in model reply' }, 502);
    try { return json(JSON.parse(m[0])); } catch { return json({ error: 'Unparseable model reply' }, 502); }
  },
};
