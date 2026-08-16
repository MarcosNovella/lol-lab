# State

Goal: local MCP server over the Riot API so LoL match data can be queried conversationally,
answering one question first: "where am I losing versus my own elo". Plan:
`C:\Users\Marcos\.claude\plans\sharded-imagining-melody.md`

Accounts: `LegendofTorcuato#LAS` (smurf, active, Platinum 2 as of 2026-08-14) and
`LaMarso#LAS` (main, level 301, no match history visible on op.gg — how much Riot still has
is an open question). Region LAS => platform `la2`, regional routing `americas`.

Log:
- 2026-08-14 S1: BUILT AND SHIPPED end to end, commit 684c9e3. Scaffold (pnpm, TS strict +
  erasableSyntaxOnly, Biome, Vitest), client layer (routing/key/limiter/client), SQLite store,
  analysis layer (stats/flatten/metrics/benchmark), 7 MCP tools, README. ADR-001..005,
  G-001..005. `pnpm verify` green (Biome + tsc + 33 tests). `pnpm smoke` boots the real
  server over stdio, lists all 7 tools and fails readably with no key. Registered in
  `~/.claude.json` at user scope as `riot`; `claude mcp list` shows it connected.

Last done: everything that can be built without a key.

Next: THE KEY. Marcos has to paste one into `.env` (the file exists, with instructions,
`RIOT_API_KEY=` empty). Then, in order:
1. `riot_key_status` — confirm it is picked up.
2. `riot_resolve_account` on both accounts — this is what finally answers how much history
   survives for `LaMarso#LAS`.
3. `riot_sync account=smurf queue=soloq max=100`.
4. THE REAL VERIFICATION, still pending: cross-check the synced matches against
   `C:\Users\Marcos\Documents\vault\_raw\lol\opgg-matches-2026-08-14.csv` — 20 smurf matches
   measured by an independent source (date, champion, role, lane opponent, KDA, CS, gold).
   If KDA, CS and lane opponent agree on all 20, the pipeline is right end to end. Riot
   returns UTC epoch; that CSV is in Argentina time, so a mismatch of exactly one day is a
   timezone bug, not a data bug.
5. `riot_benchmark account=smurf role=mid` and sanity-check that the reported n are credible.

Open questions:
- How much history survives for `LaMarso#LAS`. Unanswerable until step 2.
- Whether `laneMinionsFirst10Minutes` and the `laningPhaseGoldExpAdvantage` family are
  populated on LAS matches at this patch. If Riot leaves them null, those metrics drop out
  of the benchmark and the timeline endpoint becomes necessary for laning analysis.

Standing:
- Rate limit 20 req/s AND 100 req/2min, per region, for BOTH development and personal keys.
  Only a production key lifts it. 100 match ids per `/ids` request. So ~50 matches/minute.
- Development keys expire every 24h. The server re-reads `.env` per request, so rotating is
  a paste with nothing to restart.
- The op.gg MCP server is permanently unusable as tools: it publishes a malformed
  `outputSchema` and Claude Code rejects its whole tool list ("expected object at
  tools.26.outputSchema.type"), while still showing as connected because its resources load.
  `vault/90-meta/scripts/opgg_pull.py` talks JSON-RPC to it by hand and stays the way in.
- op.gg and Riot are complementary, not redundant: op.gg has matchup winrates over samples
  of thousands of games (meta), Riot has his own complete history (personal).
