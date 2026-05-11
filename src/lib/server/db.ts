import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  topic TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_topic_ts ON events(topic, ts);

CREATE TABLE IF NOT EXISTS metric_5m (
  metric TEXT NOT NULL,
  ts_bucket INTEGER NOT NULL,
  avg REAL,
  min REAL,
  max REAL,
  sample_count INTEGER NOT NULL,
  PRIMARY KEY (metric, ts_bucket)
);

CREATE TABLE IF NOT EXISTS accessory_runtime (
  accessory TEXT NOT NULL,
  day TEXT NOT NULL,            -- ISO date YYYY-MM-DD
  seconds_on INTEGER NOT NULL,
  PRIMARY KEY (accessory, day)
);

CREATE TABLE IF NOT EXISTS alert_rule (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  threshold_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS alert_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (rule_id) REFERENCES alert_rule(id)
);

CREATE TABLE IF NOT EXISTS push_subscription (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

let cached: Database.Database | null = null;

export function openDb(path?: string): Database.Database {
  const target = path ?? process.env.DB_PATH ?? './data/spa.db';
  if (cached && !path) return cached; // tests pass paths explicitly to avoid the cache
  mkdirSync(dirname(target), { recursive: true });
  const db = new Database(target);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  if (!path) cached = db;
  return db;
}
