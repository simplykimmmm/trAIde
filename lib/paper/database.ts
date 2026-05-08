import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PaperAccount, PaperTrade, PaperTradeStatus } from "./types";

const IS_VERCEL = Boolean(process.env.VERCEL);

const DATA_DIR =
  process.env.PAPER_DATA_DIR ??
  (IS_VERCEL
    ? path.join(tmpdir(), "traide")
    : path.join(process.cwd(), "data"));

const DB_PATH =
  process.env.PAPER_DB_PATH ??
  path.join(DATA_DIR, "paper-trading.sqlite");

declare global {
  // eslint-disable-next-line no-var
  var __traidePaperDb: Database.Database | undefined;
}

export function getDatabase(): Database.Database {
  if (!globalThis.__traidePaperDb) {
    mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new Database(DB_PATH);
    try {
  db.pragma(IS_VERCEL ? "journal_mode = DELETE" : "journal_mode = WAL");
} catch (error) {
  console.warn("SQLite journal mode setup failed", error);
}
    globalThis.__traidePaperDb = db;
    ensureSchema(db);
  }

  return globalThis.__traidePaperDb;
}

export function getPaperAccount(): PaperAccount {
  resetDailyLossIfNeeded();
  const db = getDatabase();
  return db.prepare("SELECT * FROM paper_account WHERE id = 1").get() as PaperAccount;
}

export function updatePaperAccount(values: Partial<Pick<PaperAccount, "balance" | "equity" | "daily_loss" | "last_reset_date">>): PaperAccount {
  const current = getPaperAccount();
  const next = { ...current, ...values };
  getDatabase()
    .prepare(
      `UPDATE paper_account
       SET balance = @balance, equity = @equity, daily_loss = @daily_loss, last_reset_date = @last_reset_date
       WHERE id = 1`,
    )
    .run(next);
  return getPaperAccount();
}

export function listPaperTrades(limit = 50): PaperTrade[] {
  return getDatabase()
    .prepare("SELECT * FROM paper_trades ORDER BY datetime(timestamp) DESC, id DESC LIMIT ?")
    .all(limit) as PaperTrade[];
}

export function getOpenPaperTrades(): PaperTrade[] {
  return getDatabase()
    .prepare("SELECT * FROM paper_trades WHERE status = 'OPEN' ORDER BY datetime(timestamp) ASC, id ASC")
    .all() as PaperTrade[];
}

export function insertPaperTrade(trade: Omit<PaperTrade, "id">): PaperTrade {
  const result = getDatabase()
    .prepare(
      `INSERT INTO paper_trades (
        timestamp, symbol, action, quantity, entry_price, stop_loss, take_profit, status,
        close_price, pnl, fee_approx, rejection_reason, ai_confidence, notes
      ) VALUES (
        @timestamp, @symbol, @action, @quantity, @entry_price, @stop_loss, @take_profit, @status,
        @close_price, @pnl, @fee_approx, @rejection_reason, @ai_confidence, @notes
      )`,
    )
    .run(trade);

  return getDatabase().prepare("SELECT * FROM paper_trades WHERE id = ?").get(result.lastInsertRowid) as PaperTrade;
}

export function closePaperTrade(id: number, status: PaperTradeStatus, closePrice: number, pnl: number, feeApprox: number): PaperTrade {
  getDatabase()
    .prepare(
      `UPDATE paper_trades
       SET status = @status, close_price = @closePrice, pnl = @pnl, fee_approx = fee_approx + @feeApprox
       WHERE id = @id`,
    )
    .run({ id, status, closePrice, pnl, feeApprox });

  return getDatabase().prepare("SELECT * FROM paper_trades WHERE id = ?").get(id) as PaperTrade;
}

export function getSystemState(key: string): string | null {
  const row = getDatabase().prepare("SELECT value FROM system_state WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSystemState(key: string, value: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO system_state (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

export function isKillSwitchActive(): boolean {
  return getSystemState("KILL_SWITCH") === "true";
}

export function activateKillSwitch(): void {
  setSystemState("KILL_SWITCH", "true");
  setBotRunning(false);
}

export function deactivateKillSwitch(): void {
  setSystemState("KILL_SWITCH", "false");
}

export function isBotRunning(): boolean {
  return getSystemState("BOT_RUNNING") === "true";
}

export function setBotRunning(active: boolean): void {
  setSystemState("BOT_RUNNING", active ? "true" : "false");
}

export type BotSettings = {
  refreshIntervalMinutes: number;
  refreshIntervalMs: number;
  speedMultiplier: number;
  riskMultiplier: number;
};

export function getBotSettings(): BotSettings {
  const refreshIntervalMinutes = clampNumber(Number(getSystemState("BOT_REFRESH_MINUTES") ?? 1), 1, 60);
  const speedMultiplier = calculateSpeedMultiplier(refreshIntervalMinutes);
  const riskMultiplier = clampNumber(Number(getSystemState("BOT_RISK_MULTIPLIER") ?? speedMultiplier), 1, speedMultiplier);

  return {
    refreshIntervalMinutes,
    refreshIntervalMs: refreshIntervalMinutes * 60_000,
    speedMultiplier,
    riskMultiplier,
  };
}

export function setBotSettings(input: Partial<Pick<BotSettings, "refreshIntervalMinutes" | "riskMultiplier">>): BotSettings {
  const current = getBotSettings();
  const nextRefreshIntervalMinutes = input.refreshIntervalMinutes;
  const nextRiskMultiplier = input.riskMultiplier;
  const changingSpeed = typeof nextRefreshIntervalMinutes === "number";
  const changingRisk = typeof nextRiskMultiplier === "number";

  if (!changingSpeed && !changingRisk) {
    return current;
  }

  const refreshIntervalMinutes =
    changingSpeed
      ? clampNumber(nextRefreshIntervalMinutes, 1, 60)
      : current.refreshIntervalMinutes;
  const speedMultiplier = calculateSpeedMultiplier(refreshIntervalMinutes);
  const riskMultiplier =
    changingRisk
      ? clampNumber(nextRiskMultiplier, 1, speedMultiplier)
      : changingSpeed
        ? speedMultiplier
        : current.riskMultiplier;

  setSystemState("BOT_REFRESH_MINUTES", String(refreshIntervalMinutes));
  setSystemState("BOT_RISK_MULTIPLIER", String(roundOneDecimal(riskMultiplier)));

  return getBotSettings();
}

export function resetDailyLossIfNeeded(now = new Date()): void {
  const db = getDatabase();
  const account = db.prepare("SELECT * FROM paper_account WHERE id = 1").get() as PaperAccount;
  const todayUtc = now.toISOString().slice(0, 10);

  if (account.last_reset_date !== todayUtc) {
    db.prepare("UPDATE paper_account SET daily_loss = 0, last_reset_date = ? WHERE id = 1").run(todayUtc);
  }
}

function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS paper_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      symbol TEXT NOT NULL,
      action TEXT NOT NULL,
      quantity REAL NOT NULL,
      entry_price REAL NOT NULL,
      stop_loss REAL NOT NULL,
      take_profit REAL NOT NULL,
      status TEXT DEFAULT 'OPEN',
      close_price REAL,
      pnl REAL,
      fee_approx REAL,
      rejection_reason TEXT,
      ai_confidence REAL,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS paper_account (
      id INTEGER PRIMARY KEY,
      balance REAL NOT NULL,
      equity REAL NOT NULL,
      daily_loss REAL NOT NULL DEFAULT 0,
      last_reset_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const existing = db.prepare("SELECT id FROM paper_account WHERE id = 1").get();
  if (!existing) {
    const startingBalance = Number(process.env.PAPER_START_BALANCE ?? 100_000);
    const balance = Number.isFinite(startingBalance) && startingBalance > 0 ? startingBalance : 100_000;
    db.prepare(
      `INSERT INTO paper_account (id, balance, equity, daily_loss, last_reset_date)
       VALUES (1, ?, ?, 0, ?)`,
    ).run(balance, balance, new Date().toISOString().slice(0, 10));
  }

  const killSwitch = db.prepare("SELECT key FROM system_state WHERE key = 'KILL_SWITCH'").get();
  if (!killSwitch) {
    db.prepare("INSERT INTO system_state (key, value) VALUES ('KILL_SWITCH', 'false')").run();
  }

  const botRunning = db.prepare("SELECT key FROM system_state WHERE key = 'BOT_RUNNING'").get();
  if (!botRunning) {
    db.prepare("INSERT INTO system_state (key, value) VALUES ('BOT_RUNNING', 'false')").run();
  }

  const refreshMinutes = db.prepare("SELECT key FROM system_state WHERE key = 'BOT_REFRESH_MINUTES'").get();
  if (!refreshMinutes) {
    db.prepare("INSERT INTO system_state (key, value) VALUES ('BOT_REFRESH_MINUTES', '1')").run();
  }

  const riskMultiplier = db.prepare("SELECT key FROM system_state WHERE key = 'BOT_RISK_MULTIPLIER'").get();
  if (!riskMultiplier) {
    db.prepare("INSERT INTO system_state (key, value) VALUES ('BOT_RISK_MULTIPLIER', '5')").run();
  }
}

function calculateSpeedMultiplier(refreshIntervalMinutes: number): number {
  return roundOneDecimal(1 + ((60 - refreshIntervalMinutes) / 59) * 4);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
