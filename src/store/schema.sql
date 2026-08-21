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
  -- 'insufficient_n' | 'consistent' | 'inconsistent' | 'no_effect' | 'unmeasurable'
  verdict       TEXT NOT NULL,
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

-- ================================================================================================
-- REPORTED data. Everything above this line is what Riot returned, or something derived from it.
-- Everything below is what Marcos typed, and the difference is load-bearing: a tag has no
-- opponent counterpart, so nothing under this line can ever enter a peer comparison (ADR-002's
-- whole trick is that every match ships nine other players; none of them tagged anything).
-- ================================================================================================

-- One row per sitting, because tilt is a property of the SITTING and the tag is a property of the
-- game. Folding them into one row would force the tilt to be repeated per game or invented.
CREATE TABLE IF NOT EXISTS play_sessions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  puuid     TEXT NOT NULL,
  opened_at INTEGER NOT NULL,     -- epoch ms
  closed_at INTEGER,              -- NULL while the sitting is still open
  -- 1-5, and NULL means NOT REPORTED, never "neutral". A session closed without a tilt is a
  -- session with no tilt measurement, and imputing 3 would be exactly the substitution G-005
  -- exists to prevent.
  tilt      INTEGER CHECK (tilt IS NULL OR (tilt BETWEEN 1 AND 5)),
  FOREIGN KEY (puuid) REFERENCES accounts (puuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS play_sessions_puuid ON play_sessions (puuid, opened_at DESC);

-- The attribution tag: whose result was this?
--   'mía'    — I produced it
--   'igual'  — it was going to end this way without me
--   'pareja' — it could have gone either way
-- It reads the same for a win and for a defeat on purpose, so it is one tap per GAME rather than
-- a defeat-only questionnaire that quietly stops being filled in during a good week.
CREATE TABLE IF NOT EXISTS game_tags (
  match_id   TEXT NOT NULL,
  puuid      TEXT NOT NULL,
  session_id INTEGER,
  tag        TEXT NOT NULL CHECK (tag IN ('mía', 'igual', 'pareja')),
  -- WHEN it was typed, always. A tag put in three days later is memory, not observation, and a
  -- reader that cannot tell the two apart is trusting recall it never measured.
  tagged_at  INTEGER NOT NULL,
  PRIMARY KEY (match_id, puuid),
  FOREIGN KEY (match_id)   REFERENCES matches (match_id)    ON DELETE CASCADE,
  FOREIGN KEY (puuid)      REFERENCES accounts (puuid)      ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES play_sessions (id)    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS game_tags_puuid ON game_tags (puuid, tagged_at DESC);

-- Small key/value store for DECISIONS that change what the engine asks him for.
--
-- It exists for one of them: `tag_cutoff`. He decided on 2026-08-19 not to tag the games that
-- were already in the cache — tagging a two-week-old game is memory, not observation, which is
-- the exact distinction ADR-015 draws — and a backlog that can never be cleared turns the
-- panel's one urgent action into permanent noise. Recording it as a dated decision keeps the
-- untagged games visible as a stated choice instead of silently filtering them away.
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL,
  set_at INTEGER NOT NULL
);

-- Data Dragon's item table, ONE ROW PER ITEM PER VERSION.
--
-- The version is part of the key on purpose: his cache spans patches 16.6 to 16.16, and an
-- item's build path changes between them. A single "latest" table would silently reclassify
-- items in old games, which is the scope error G-015 exists to prevent.
CREATE TABLE IF NOT EXISTS items (
  item_id    INTEGER NOT NULL,
  version    TEXT NOT NULL,
  name       TEXT NOT NULL,
  gold_total INTEGER NOT NULL,
  -- 1 when nothing in that patch builds out of it. Derived from the data, never hardcoded.
  finished   INTEGER NOT NULL,
  tags       TEXT NOT NULL,
  PRIMARY KEY (item_id, version)
);

-- Cada vez que el briefing previo a jugar le MOSTRÓ una hipótesis viva.
--
-- Existe para que la contaminación sea medible en vez de una nota al pie. Una fila del ledger se
-- evalúa contra las partidas posteriores a su registro, y §4.8 ya dejó anotado que contársela
-- mezcla "el patrón era real" con "se lo dijeron y reaccionó". Mostrarla antes de jugar es
-- exactamente eso, a propósito y por la razón de `analysis/briefing.ts`; lo que no se puede es
-- que después no se sepa desde cuándo.
--
-- Append-only como el ledger, y por lo mismo: la primera exposición es irreversible y borrarla
-- sería borrar la única prueba de que el veredicto que viene tiene un asterisco.
CREATE TABLE IF NOT EXISTS briefing_exposures (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hypothesis_id TEXT    NOT NULL,
  puuid         TEXT    NOT NULL,
  shown_at      INTEGER NOT NULL,
  FOREIGN KEY (hypothesis_id) REFERENCES hypotheses (id) ON DELETE CASCADE,
  FOREIGN KEY (puuid)         REFERENCES accounts   (puuid) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS briefing_exposures_hid
  ON briefing_exposures (hypothesis_id, shown_at);

-- Runes and champion classes, cached PER PATCH from Data Dragon, exactly like `items` and for
-- the same reason (ADR-020): a rune's tree and a champion's class both change between patches,
-- and reading a 15.x game against the newest table would silently relabel it. A patch with no
-- catalogue is REPORTED as having none rather than read against another one.
CREATE TABLE IF NOT EXISTS runes (
  rune_id   INTEGER NOT NULL,
  version   TEXT    NOT NULL,
  key       TEXT    NOT NULL,
  name      TEXT    NOT NULL,
  tree_id   INTEGER NOT NULL,
  tree_key  TEXT    NOT NULL,
  tree_name TEXT    NOT NULL,
  -- Slot 0 of a tree holds its keystones and nothing else, which is what makes a keystone
  -- identifiable without a hardcoded id list that goes stale every preseason.
  slot      INTEGER NOT NULL,
  icon      TEXT    NOT NULL,
  PRIMARY KEY (rune_id, version)
);

CREATE TABLE IF NOT EXISTS champions (
  champion_id INTEGER NOT NULL,
  version     TEXT    NOT NULL,
  key         TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  -- Comma-joined: Assassin, Fighter, Mage, Marksman, Support, Tank. A champion has one or two.
  tags        TEXT    NOT NULL,
  PRIMARY KEY (champion_id, version)
);

CREATE INDEX IF NOT EXISTS idx_champions_key ON champions (key);
