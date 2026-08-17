-- Applied on every open, so every statement must be idempotent.

CREATE TABLE IF NOT EXISTS accounts (
  puuid          TEXT PRIMARY KEY,
  game_name      TEXT NOT NULL,
  tag_line       TEXT NOT NULL,
  platform       TEXT NOT NULL,
  summoner_level INTEGER,
  label          TEXT,               -- 'smurf' | 'main' | free text, set by the user
  last_synced_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_riot_id
  ON accounts (lower(game_name), lower(tag_line), platform);

-- Raw match JSON is kept whole (ADR-004): matches are immutable once played, so this cache
-- never needs invalidating, and a metric we did not flatten today is derivable tomorrow
-- without spending requests again.
CREATE TABLE IF NOT EXISTS matches (
  match_id      TEXT PRIMARY KEY,
  queue_id      INTEGER NOT NULL,
  game_creation INTEGER NOT NULL,     -- epoch ms, UTC
  game_duration INTEGER NOT NULL,     -- seconds
  game_version  TEXT,
  patch         TEXT,                 -- 'major.minor' from game_version
  map_id        INTEGER,
  raw           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS matches_queue_created ON matches (queue_id, game_creation DESC);

-- One row per player per match, including the nine other players: that is what makes the
-- peer benchmark free (ADR-002).
CREATE TABLE IF NOT EXISTS participants (
  match_id             TEXT NOT NULL,
  puuid                TEXT NOT NULL,
  team_id              INTEGER NOT NULL,
  team_position        TEXT NOT NULL,
  champion_id          INTEGER NOT NULL,
  champion             TEXT NOT NULL,
  win                  INTEGER NOT NULL,
  kills                INTEGER NOT NULL,
  deaths               INTEGER NOT NULL,
  assists              INTEGER NOT NULL,
  cs                   INTEGER NOT NULL,
  gold                 INTEGER NOT NULL,
  damage_champions     INTEGER NOT NULL,
  damage_taken         INTEGER NOT NULL,
  damage_objectives    INTEGER,
  vision_score         INTEGER NOT NULL,
  control_wards        INTEGER,
  wards_placed         INTEGER,
  wards_killed         INTEGER,
  time_ccing           INTEGER,
  duration_minutes     REAL NOT NULL,
  -- derived per-minute / share metrics, precomputed so queries stay simple
  cs_per_min           REAL NOT NULL,
  gold_per_min         REAL NOT NULL,
  damage_per_min       REAL NOT NULL,
  damage_taken_per_min REAL NOT NULL,
  vision_per_min       REAL NOT NULL,
  deaths_per_min       REAL NOT NULL,
  kda                  REAL NOT NULL,
  -- straight out of Riot's `challenges` block; NULL when Riot did not report them
  kill_participation   REAL,
  team_damage_share    REAL,
  solo_kills           INTEGER,
  turret_plates        INTEGER,
  cs_first_10          REAL,
  max_cs_adv_on_lane   REAL,
  early_lane_adv       REAL,
  lane_adv             REAL,
  PRIMARY KEY (match_id, puuid),
  FOREIGN KEY (match_id) REFERENCES matches (match_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS participants_puuid   ON participants (puuid);
CREATE INDEX IF NOT EXISTS participants_role    ON participants (team_position);
CREATE INDEX IF NOT EXISTS participants_champ   ON participants (champion);

CREATE TABLE IF NOT EXISTS timelines (
  match_id TEXT PRIMARY KEY,
  raw      TEXT NOT NULL,
  FOREIGN KEY (match_id) REFERENCES matches (match_id) ON DELETE CASCADE
);

-- Rank over time, one row per observation.
--
-- Exists because match-v5 carries NO rank, tier, LP or MMR on any of its 156 participant
-- fields (verified 2026-08-16, ADR-012), and league-v4 answers only "where is this account
-- NOW". So a rank series cannot be reconstructed for a game already played: it only exists
-- from the first day something records it. Every day without this table is a day of growth
-- curve that can never be annotated with a real division.
--
-- Append-only, and deliberately not keyed on the day: two observations in one day are two
-- rows, because LP moves within a session and the session is the interesting unit.
CREATE TABLE IF NOT EXISTS rank_snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  puuid       TEXT NOT NULL,
  observed_at INTEGER NOT NULL,     -- epoch ms
  queue_type  TEXT NOT NULL,        -- 'RANKED_SOLO_5x5' | 'RANKED_FLEX_SR'
  tier        TEXT,                 -- NULL while unranked: absence is the honest value
  division    TEXT,
  league_points INTEGER,
  wins        INTEGER,
  losses      INTEGER,
  FOREIGN KEY (puuid) REFERENCES accounts (puuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS rank_snapshots_puuid_time
  ON rank_snapshots (puuid, queue_type, observed_at DESC);

-- The hypothesis ledger. Every finding the engine surfaces is registered as a dated PREDICTION
-- and evaluated ONLY against games played after that moment. Append-only: the single permitted
-- mutation is retiring a row, which sets `retired_at`/`retired_reason` once and never rewrites
-- the claim or the spec.
CREATE TABLE IF NOT EXISTS hypotheses (
  id              TEXT PRIMARY KEY,
  -- A TIMESTAMP, never a date. Registering on a day he also plays makes "games after this"
  -- ambiguous, which is not hypothetical: three games arrived hours after the finding existed.
  registered_at   INTEGER NOT NULL,
  claim           TEXT NOT NULL,
  direction       TEXT NOT NULL,      -- 'lower' | 'higher' | 'none'
  spec            TEXT NOT NULL,      -- canonical JSON of the AnalysisSpec, key order fixed
  spec_hash       TEXT NOT NULL,      -- G-013: evaluation under any other spec is refused
  -- Two boundaries, not one. Games at or before `baseline_until` are the frozen baseline;
  -- games at or after `test_from` are out-of-sample. Anything BETWEEN them is a declared hole:
  -- played after the finding existed (so not clean baseline) and before registration (so not
  -- clean test). `gap_games` counts them so the hole can never be silent.
  baseline_until  INTEGER NOT NULL,
  test_from       INTEGER NOT NULL,
  gap_games       INTEGER NOT NULL,
  baseline_n      INTEGER NOT NULL,
  -- NULL means "not measurable", never zero. `node:sqlite` binds NaN as NULL, and the read
  -- path maps it back to NaN explicitly: `Number(null)` is 0, which is the single most
  -- dangerous value this column could take (G-005, G-014).
  baseline_effect REAL,
  n_needed        INTEGER NOT NULL,
  caveat          TEXT NOT NULL,
  retired_at      INTEGER,
  retired_reason  TEXT
);

-- Append-only. Stores account and elo per evaluation, because a hypothesis that holds on the
-- smurf and fails on the main is not a contradiction — it is evidence the pattern is
-- level-dependent, and merging the two would file that as noise.
CREATE TABLE IF NOT EXISTS hypothesis_evaluations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hypothesis_id TEXT NOT NULL,
  evaluated_at  INTEGER NOT NULL,
  puuid         TEXT NOT NULL,
  elo           TEXT,
  n             INTEGER NOT NULL,
  effect        REAL,               -- NULL = not measurable. See baseline_effect above (G-014).
  verdict       TEXT NOT NULL,      -- 'insufficient_n' | 'consistent' | 'inconsistent' | 'no_effect'
  FOREIGN KEY (hypothesis_id) REFERENCES hypotheses (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS hypothesis_evaluations_hid
  ON hypothesis_evaluations (hypothesis_id, evaluated_at DESC);

CREATE TABLE IF NOT EXISTS sync_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  puuid        TEXT NOT NULL,
  queue_id     INTEGER,
  started_at   INTEGER NOT NULL,
  finished_at  INTEGER,
  ids_seen     INTEGER NOT NULL DEFAULT 0,
  fetched      INTEGER NOT NULL DEFAULT 0,
  skipped      INTEGER NOT NULL DEFAULT 0,
  timelines    INTEGER NOT NULL DEFAULT 0,
  error        TEXT
);
