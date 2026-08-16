# Guardrails

One line per rule. Born from a real error, so the CLASS of error cannot recur.
Format: `- [G-00N] <imperative rule> — cause: <what broke> (YYYY-MM-DD)`

- [G-001] NEVER write to stdout in the server process — stdout is the MCP JSON-RPC channel and any stray byte corrupts the protocol. Log to stderr only. Enforced by Biome `noConsole` (allows `console.error`) — cause: preventive, this is the single most common way an stdio MCP server breaks (2026-08-14)
- [G-002] NEVER log, echo, or return the API key value from any tool, error message, or stack trace. `riot_key_status` reports presence and validity, never the value — cause: preventive, a leaked key in a transcript is a real credential leak (2026-08-14)
- [G-003] Write erasable-only TypeScript: no `enum`, no `namespace`, no parameter properties, and `import type` for every type-only import. Node strips types without a compiler, so non-erasable syntax fails at RUNTIME, not at typecheck. Enforced by `erasableSyntaxOnly` in tsconfig — cause: preventive, the project deliberately has no build step (2026-08-14)
- [G-004] Derive role from `teamPosition`, never `individualPosition`, and drop participants whose `teamPosition` is empty — cause: preventive, remakes and some queues leave it blank and the row silently pollutes role benchmarks (2026-08-14)
- [G-005] Never let a single statistic decide whether a gap exists. Any ranking built on an effect size must carry an explicit fallback for the degenerate case (zero or near-zero pooled variance), and must never report "no difference" merely because the statistic was undefined — cause: `cohensD` returns NaN when both samples have zero variance, and `severityOf` mapped NaN to 'parejo', so a player farming 5.0 CS/min against peers at 7.0 was reported as even — the exact gap the tool exists to find (2026-08-14)
