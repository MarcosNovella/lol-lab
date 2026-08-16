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
