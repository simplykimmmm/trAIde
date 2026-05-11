import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { PaperAccount, PaperTrade, PaperTradeStatus } from "./types";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

export type BotSettings = {
  refreshIntervalMinutes: number;
  refreshIntervalMs: number;
  speedMultiplier: number;
  riskMultiplier: number;
};

let sqlite: Database.Database | null = null;

export function getPaperStorageProvider(): "supabase" | "sqlite" {
  return isSupabaseConfigured() ? "supabase" : "sqlite";
}

export async function getPaperAccount(): Promise<PaperAccount> {
  await ensureSeedData();
  await resetDailyLossIfNeeded();

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return getLocalPaperAccount();
  }

  const { data, error } = await supabase
    .from("paper_account")
    .select("*")
    .eq("id", 1)
    .single();

  if (error || !data) {
    throw new Error(`Failed to load paper account: ${error?.message}`);
  }

  return normalizePaperAccount(data);
}

export async function updatePaperAccount(
  values: Partial<Pick<PaperAccount, "balance" | "equity" | "daily_loss" | "last_reset_date">>,
): Promise<PaperAccount> {
  const current = await getPaperAccount();
  const next = { ...current, ...values };
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    getLocalDb()
      .prepare("UPDATE paper_account SET balance = ?, equity = ?, daily_loss = ?, last_reset_date = ? WHERE id = 1")
      .run(next.balance, next.equity, next.daily_loss, next.last_reset_date);
    return getLocalPaperAccount();
  }

  const { data, error } = await supabase
    .from("paper_account")
    .update(next)
    .eq("id", 1)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to update paper account: ${error?.message}`);
  }

  return normalizePaperAccount(data);
}

export async function listPaperTrades(limit = 50): Promise<PaperTrade[]> {
  await ensureSeedData();
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    const rows = getLocalDb()
      .prepare("SELECT * FROM paper_trades ORDER BY timestamp DESC, id DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map(normalizePaperTrade);
  }

  const { data, error } = await supabase
    .from("paper_trades")
    .select("*")
    .order("timestamp", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list paper trades: ${error.message}`);
  }

  return (data ?? []).map(normalizePaperTrade);
}

export async function getOpenPaperTrades(): Promise<PaperTrade[]> {
  await ensureSeedData();
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    const rows = getLocalDb()
      .prepare("SELECT * FROM paper_trades WHERE status = 'OPEN' ORDER BY timestamp ASC, id ASC")
      .all() as Record<string, unknown>[];
    return rows.map(normalizePaperTrade);
  }

  const { data, error } = await supabase
    .from("paper_trades")
    .select("*")
    .eq("status", "OPEN")
    .order("timestamp", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw new Error(`Failed to list open paper trades: ${error.message}`);
  }

  return (data ?? []).map(normalizePaperTrade);
}

export async function insertPaperTrade(trade: Omit<PaperTrade, "id">): Promise<PaperTrade> {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    const result = getLocalDb()
      .prepare(`
        INSERT INTO paper_trades (
          timestamp, symbol, action, quantity, entry_price, stop_loss, take_profit,
          status, close_price, pnl, fee_approx, rejection_reason, ai_confidence, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        trade.timestamp,
        trade.symbol,
        trade.action,
        trade.quantity,
        trade.entry_price,
        trade.stop_loss,
        trade.take_profit,
        trade.status,
        trade.close_price,
        trade.pnl,
        trade.fee_approx,
        trade.rejection_reason,
        trade.ai_confidence,
        trade.notes,
      );

    return normalizePaperTrade(
      getLocalDb()
        .prepare("SELECT * FROM paper_trades WHERE id = ?")
        .get(Number(result.lastInsertRowid)) as Record<string, unknown>,
    );
  }

  const { data, error } = await supabase
    .from("paper_trades")
    .insert(trade)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert paper trade: ${error?.message}`);
  }

  return normalizePaperTrade(data);
}

export async function closePaperTrade(
  id: number,
  status: PaperTradeStatus,
  closePrice: number,
  pnl: number,
  feeApprox: number,
): Promise<PaperTrade> {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    const current = normalizePaperTrade(
      getLocalDb().prepare("SELECT * FROM paper_trades WHERE id = ?").get(id) as Record<string, unknown>,
    );

    getLocalDb()
      .prepare("UPDATE paper_trades SET status = ?, close_price = ?, pnl = ?, fee_approx = ? WHERE id = ?")
      .run(status, closePrice, pnl, current.fee_approx + feeApprox, id);

    return normalizePaperTrade(
      getLocalDb().prepare("SELECT * FROM paper_trades WHERE id = ?").get(id) as Record<string, unknown>,
    );
  }

  const existing = await supabase
    .from("paper_trades")
    .select("*")
    .eq("id", id)
    .single();

  if (existing.error || !existing.data) {
    throw new Error(`Failed to load trade before close: ${existing.error?.message}`);
  }

  const current = normalizePaperTrade(existing.data);

  const { data, error } = await supabase
    .from("paper_trades")
    .update({
      status,
      close_price: closePrice,
      pnl,
      fee_approx: current.fee_approx + feeApprox,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to close paper trade: ${error?.message}`);
  }

  return normalizePaperTrade(data);
}

export async function getSystemState(key: string): Promise<string | null> {
  await ensureSeedData();
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    const row = getLocalDb().prepare("SELECT value FROM system_state WHERE key = ?").get(key) as { value?: string } | undefined;
    return row?.value ?? null;
  }

  const { data, error } = await supabase
    .from("system_state")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get system state ${key}: ${error.message}`);
  }

  return data?.value ?? null;
}

export async function setSystemState(key: string, value: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    getLocalDb()
      .prepare("INSERT INTO system_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
    return;
  }

  const { error } = await supabase
    .from("system_state")
    .upsert({ key, value }, { onConflict: "key" });

  if (error) {
    throw new Error(`Failed to set system state ${key}: ${error.message}`);
  }
}

export async function isKillSwitchActive(): Promise<boolean> {
  return (await getSystemState("KILL_SWITCH")) === "true";
}

export async function activateKillSwitch(): Promise<void> {
  await setSystemState("KILL_SWITCH", "true");
  await setBotRunning(false);
}

export async function deactivateKillSwitch(): Promise<void> {
  await setSystemState("KILL_SWITCH", "false");
}

export async function isBotRunning(): Promise<boolean> {
  return (await getSystemState("BOT_RUNNING")) === "true";
}

export async function setBotRunning(active: boolean): Promise<void> {
  await setSystemState("BOT_RUNNING", active ? "true" : "false");
}

export async function getBotSettings(): Promise<BotSettings> {
  const refreshIntervalMinutes = clampNumber(Number((await getSystemState("BOT_REFRESH_MINUTES")) ?? 1), 1, 60);
  const speedMultiplier = calculateSpeedMultiplier(refreshIntervalMinutes);
  const riskMultiplier = clampNumber(Number((await getSystemState("BOT_RISK_MULTIPLIER")) ?? speedMultiplier), 1, speedMultiplier);

  return {
    refreshIntervalMinutes,
    refreshIntervalMs: refreshIntervalMinutes * 1_000,
    speedMultiplier,
    riskMultiplier,
  };
}

export async function setBotSettings(
  input: Partial<Pick<BotSettings, "refreshIntervalMinutes" | "riskMultiplier">>,
): Promise<BotSettings> {
  const current = await getBotSettings();
  const changingSpeed = typeof input.refreshIntervalMinutes === "number";
  const changingRisk = typeof input.riskMultiplier === "number";

  if (!changingSpeed && !changingRisk) {
    return current;
  }

  const refreshIntervalMinutes = changingSpeed
    ? clampNumber(input.refreshIntervalMinutes!, 1, 60)
    : current.refreshIntervalMinutes;

  const speedMultiplier = calculateSpeedMultiplier(refreshIntervalMinutes);

  const riskMultiplier = changingRisk
    ? clampNumber(input.riskMultiplier!, 1, speedMultiplier)
    : changingSpeed
      ? speedMultiplier
      : current.riskMultiplier;

  await setSystemState("BOT_REFRESH_MINUTES", String(refreshIntervalMinutes));
  await setSystemState("BOT_RISK_MULTIPLIER", String(roundOneDecimal(riskMultiplier)));

  return getBotSettings();
}

export async function resetDailyLossIfNeeded(now = new Date()): Promise<void> {
  const todayUtc = now.toISOString().slice(0, 10);
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    const account = getLocalPaperAccount();
    if (account.last_reset_date !== todayUtc) {
      getLocalDb()
        .prepare("UPDATE paper_account SET daily_loss = 0, last_reset_date = ? WHERE id = 1")
        .run(todayUtc);
    }
    return;
  }

  const { data, error } = await supabase
    .from("paper_account")
    .select("*")
    .eq("id", 1)
    .single();

  if (error || !data) return;

  const account = normalizePaperAccount(data);

  if (account.last_reset_date !== todayUtc) {
    await supabase
      .from("paper_account")
      .update({ daily_loss: 0, last_reset_date: todayUtc })
      .eq("id", 1);
  }
}

async function ensureSeedData(): Promise<void> {
  const todayUtc = new Date().toISOString().slice(0, 10);
  const startingBalance = Number(process.env.PAPER_START_BALANCE ?? 100_000);
  const balance = Number.isFinite(startingBalance) && startingBalance > 0 ? startingBalance : 100_000;
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    ensureLocalSchema();
    getLocalDb()
      .prepare("INSERT OR IGNORE INTO paper_account (id, balance, equity, daily_loss, last_reset_date) VALUES (1, ?, ?, 0, ?)")
      .run(balance, balance, todayUtc);
    seedLocalState();
    return;
  }

  await supabase
    .from("paper_account")
    .upsert(
      { id: 1, balance, equity: balance, daily_loss: 0, last_reset_date: todayUtc },
      { onConflict: "id", ignoreDuplicates: true },
    );

  await supabase
    .from("system_state")
    .upsert(
      [
        { key: "KILL_SWITCH", value: "false" },
        { key: "BOT_RUNNING", value: "false" },
        { key: "BOT_REFRESH_MINUTES", value: "1" },
        { key: "BOT_RISK_MULTIPLIER", value: "5" },
      ],
      { onConflict: "key", ignoreDuplicates: true },
    );
}

function getLocalDb(): Database.Database {
  if (sqlite) {
    return sqlite;
  }

  const dataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  sqlite = new Database(path.join(dataDir, "paper-trading.sqlite"));
  ensureLocalSchema();
  return sqlite;
}

function ensureLocalSchema(): void {
  const db = sqlite ?? getLocalDb();
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
}

function getLocalPaperAccount(): PaperAccount {
  const row = getLocalDb().prepare("SELECT * FROM paper_account WHERE id = 1").get() as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error("Failed to load local paper account.");
  }

  return normalizePaperAccount(row);
}

function seedLocalState(): void {
  const db = getLocalDb();
  const statement = db.prepare("INSERT OR IGNORE INTO system_state (key, value) VALUES (?, ?)");
  statement.run("KILL_SWITCH", "false");
  statement.run("BOT_RUNNING", "false");
  statement.run("BOT_REFRESH_MINUTES", "1");
  statement.run("BOT_RISK_MULTIPLIER", "5");
}

function normalizePaperAccount(row: Record<string, unknown>): PaperAccount {
  return {
    id: Number(row.id),
    balance: Number(row.balance),
    equity: Number(row.equity),
    daily_loss: Number(row.daily_loss),
    last_reset_date: String(row.last_reset_date),
  };
}

function normalizePaperTrade(row: Record<string, unknown>): PaperTrade {
  return {
    id: Number(row.id),
    timestamp: String(row.timestamp),
    symbol: String(row.symbol),
    action: row.action as PaperTrade["action"],
    quantity: Number(row.quantity),
    entry_price: Number(row.entry_price),
    stop_loss: Number(row.stop_loss),
    take_profit: Number(row.take_profit),
    status: row.status as PaperTradeStatus,
    close_price: row.close_price === null ? null : Number(row.close_price),
    pnl: row.pnl === null ? null : Number(row.pnl),
    fee_approx: Number(row.fee_approx),
    rejection_reason: row.rejection_reason === null ? null : String(row.rejection_reason),
    ai_confidence: row.ai_confidence === null ? null : Number(row.ai_confidence),
    notes: row.notes === null ? null : String(row.notes),
  };
}

function calculateSpeedMultiplier(refreshIntervalMinutes: number): number {
  return roundOneDecimal(1 + ((60 - refreshIntervalMinutes) / 59) * 4);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
