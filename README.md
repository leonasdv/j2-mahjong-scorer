# J2 Mahjong Scorer (prototype)

A Progressive Web App for J2 Mahjong League tables. Players photograph the winning hand, the app reads the tiles, the user fixes any misreads, and the hand is scored with the official J2 rules (Panduan Skor, Oktober 2026). Matches are shared live so all four players see every hand on their own phones.

## Flow

Photo → Tiles view (drag, reorder, replace) → Confirm (winner, discarder, special situations) → Points → Save to match

## What's in this prototype

- **Scoring engine** (`public/scoring.js`): all 47 combinations, non-stacking rules and the KV.3 ×4 penalty. Pure JavaScript, no dependencies, runs in the browser and in Node. It tries every valid arrangement of the hand (jokers are wildcards) and keeps the highest-scoring one. Standard hands, seven pairs (#32–34), thirteen orphans (#43), nine gates (#41) and four kongs (#44) are supported.
- **Matches**: 2–4 players in seat order, joker tile chosen from a grid or by photo, dealer and round wind rotate automatically, draws keep the dealer.
- **Tiles view**: flowers, revealed sets and hand as separate rows. Drag between rows (SortableJS), tap a tile to replace, remove or move it. Flowers are kept in the flower row automatically.
- **PWA**: manifest, offline shell cache, installable to the home screen, no APK.

## Run locally

```
npm start      # serves public/ at http://localhost:5173
npm test       # scoring engine test hands
```

Standalone, the app saves matches on the device (localStorage) and tile entry is manual. Photo reading and live sharing need the backend below.

## Production plan

| Concern | Prototype (claude.ai artifact) | Production |
|---|---|---|
| Login | claude.ai account | Supabase Auth with Google sign-in |
| Shared live matches | Artifact database with live snapshots | Supabase Postgres + Realtime (`matches`, `hands`, `match_players`) |
| Tile recognition | Claude vision via the artifact runtime | Small backend endpoint calling the Claude API with the same prompt; set `RECOGNIZE_URL` in `index.html` |
| Hosting | claude.ai link | Any static host (Vercel, Netlify, Cloudflare Pages) |

The storage layer is isolated behind `LocalStore` / `DbStore` in `index.html`; a `SupabaseStore` with the same six methods (`listMatches`, `watchMatch`, `watchHands`, `createMatch`, `updateMatch`, `addHand`) is the only change needed for live sharing. Recognition is isolated in `recognize()`.

The API key for recognition must stay on the server. Never call the Claude API directly from the PWA.

## Rule interpretations to confirm with the league

1. **Joker tile is always a joker**, even in its natural position (confirmed). A natural pair or pong of the joker tile therefore scores #24 / #25.
2. **Payments**: default is "discarder pays the full points; on self-draw each other player pays". KV.3 multiplies the points by 4 and the discarder pays. An alternative "winner's points only" tally is selectable per match. The guide doesn't specify this; needs confirmation.
3. **Stacking not stated in the guide is allowed.** E.g. Big three dragons (#36) also collects the dragon pongs (#12/#13) because the guide only blocks that for Small three dragons (#31). Same for Big/Small four winds with #14/#15.
4. **Seat number for flowers** = seat wind order (East 1, South 2, West 3, North 4), with the dealer as East.
5. **#28 Three concealed pongs** counts any pong formed in the hand, including one completed by the winning discard.
6. **#24 Joker pair** applies only to the pair of a standard hand, not to seven pairs.
7. **KV.3 trigger** is detected automatically from the revealed sets and can be overridden on the Points screen.

## Enable photo reading on GitHub Pages

Photo reading needs a small proxy so the Gemini API key never reaches the browser. `supabase/functions/recognize` is a Supabase Edge Function that does this.

```
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase secrets set GEMINI_API_KEY=<your key>
npx supabase functions deploy recognize --no-verify-jwt
```

Then set `RECOGNIZE_URL` in `public/index.html` to `https://<your-project-ref>.supabase.co/functions/v1/recognize`, commit and push. Pages redeploys and the photo buttons appear. The function only accepts requests from `https://leonasdv.github.io` and `http://localhost:5173` (edit `ALLOWED_ORIGINS` to change).
