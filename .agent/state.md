# State

Goal: local MCP server over the Riot API so LoL match data can be queried conversationally,
answering one question first: "where am I losing versus my own elo". Plan:
`C:\Users\Marcos\.claude\plans\sharded-imagining-melody.md`

Accounts: `LegendofTorcuato#LAS` (smurf, active, Platinum 2) and `LaMarso#LAS` (main, level
301, no match history visible on op.gg — how much Riot still has is an open question).
Region LAS => platform `la2`, regional routing `americas`.

Log:
- 2026-08-14 S1: scaffolded (pnpm, TS strict + erasableSyntaxOnly, Biome, Vitest, .agent).
  ADR-001..005 written. Node 24 runs .ts natively and ships node:sqlite, so the runtime has
  exactly one dependency (@modelcontextprotocol/sdk) and no build step.

Last done: scaffold.

Next: client layer (routing/key/limiter/client) -> store -> analysis -> tools -> verify.

Open questions:
- Marcos has NO Riot API key yet. Nothing hits the network until he pastes one into `.env`.
  Everything up to that point is buildable and unit-testable against fixtures.
- How much history survives for `LaMarso#LAS`. Answered by `riot_resolve_account` + a sync
  attempt once there is a key.

Standing:
- Rate limit is 20 req/s AND 100 req/2min, per region, for both development and personal
  keys. Only a production key lifts it. 100 match ids per `/ids` request.
- Cross-check source for verification: `C:\Users\Marcos\Documents\vault\_raw\lol\opgg-matches-2026-08-14.csv`
  (last 20 smurf matches from an independent source, timestamps in Argentina time, Riot's are UTC epoch).
