"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Check, ListChecks, Pause, Play, Power, RefreshCw, ShieldAlert, ShieldCheck, X } from "lucide-react";

type Mode = "paper" | "live";

type AccountResponse = {
  marketDataProvider: "finnhub" | "mock-etoro";
  liveTradingEnabled: boolean;
  killSwitchActive: boolean;
  botRunning: boolean;
  botSettings: {
    refreshIntervalMinutes: number;
    refreshIntervalMs: number;
    speedMultiplier: number;
    riskMultiplier: number;
  };
  deployment: {
    host: "local" | "vercel";
    hasFinnhubKey: boolean;
    hasGeminiKey: boolean;
    storage: "local-sqlite" | "ephemeral-sqlite";
    warnings: string[];
  };
  account: {
    currency: string;
    balance: number;
    equity: number;
    availableCash: number;
    dailyPnl: number;
    dailyLoss: number;
    dailyLossLimit: number;
    dailyLossUsedPct: number;
    openPositionCount: number;
    updatedAt: string;
  };
  riskConfig: {
    maxRiskPerTradePct: number;
    maxDailyLossPct: number;
    maxOpenPositions: number;
    minAIConfidence: number;
    allowLeverage: boolean;
    allowShortSelling: boolean;
    paperExposureMultiplier: number;
    maxAccountRiskPct: number;
    dataStaleThresholdMs: number;
  };
};

type Position = {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  stopLoss: number;
  takeProfit: number;
  openedAt: string;
};

type Analysis = {
  symbol: string;
  action: "BUY" | "SELL" | "HOLD";
  confidence: number;
  reasoning: string;
  invalidation_condition: string;
  lastPrice?: number;
  error?: string;
};

type Suggestion = {
  id: string;
  symbol: string;
  action: "BUY" | "SELL";
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskAmount: number;
  confidence: number;
  reasoning: string;
  invalidationCondition: string;
};

type Trade = {
  id: number;
  timestamp: string;
  symbol: string;
  action: string;
  quantity: number;
  entry_price: number;
  close_price: number | null;
  pnl: number | null;
  fee_approx: number;
  status: string;
  rejection_reason: string | null;
  ai_confidence: number | null;
  notes: string | null;
};

const DISCLAIMER = "Educational prototype only. Not financial advice. No profit is promised or implied.";
const BACKTEST_DISCLAIMER =
  "⚠️ Past performance does not guarantee future results. Backtesting has significant limitations including survivorship bias and look-ahead bias.";

export default function DashboardPage() {
  const [mode, setMode] = useState<Mode>("paper");
  const [account, setAccount] = useState<AccountResponse | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draftSpeedLevel, setDraftSpeedLevel] = useState(60);
  const [draftRiskMultiplier, setDraftRiskMultiplier] = useState(5);

  const activityRows = useMemo(() => buildActivityRows(suggestions, positions, trades), [positions, suggestions, trades]);
  const allMoves = useMemo(() => buildAllMoves(suggestions, positions, analyses, trades), [analyses, positions, suggestions, trades]);
  const realizedPnl = useMemo(() => trades.reduce((sum, trade) => sum + (trade.status.startsWith("CLOSED") ? trade.pnl ?? 0 : 0), 0), [trades]);
  const unrealizedPnl = useMemo(() => positions.reduce((sum, position) => sum + position.unrealizedPnl, 0), [positions]);
  const totalFees = useMemo(() => trades.reduce((sum, trade) => sum + (trade.fee_approx || 0), 0), [trades]);
  const openStake = useMemo(() => positions.reduce((sum, position) => sum + position.quantity * position.currentPrice, 0), [positions]);
  const suggestedStake = useMemo(() => suggestions.reduce((sum, suggestion) => sum + suggestion.quantity * suggestion.entryPrice, 0), [suggestions]);
  const pnlSeries = useMemo(() => buildPnlSeries(trades, unrealizedPnl), [trades, unrealizedPnl]);
  const liveAllowed = account?.liveTradingEnabled === true;
  const killActive = account?.killSwitchActive === true;
  const botRunning = account?.botRunning === true && !killActive;
  const deploymentWarnings = account?.deployment.warnings ?? [];
  const draftRefreshMinutes = speedLevelToMinutes(draftSpeedLevel);
  const draftSpeedMultiplier = calculateSpeedMultiplier(draftRefreshMinutes);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [accountRes, positionsRes, analysisRes, suggestRes, tradesRes] = await Promise.all([
        fetch("/api/account", { cache: "no-store" }),
        fetch("/api/positions", { cache: "no-store" }),
        fetch("/api/analysis", { cache: "no-store" }),
        fetch(`/api/suggest?mode=${mode}`, { cache: "no-store" }),
        fetch("/api/paper-trades", { cache: "no-store" }),
      ]);

      setAccount(await accountRes.json());
      setPositions((await positionsRes.json()).positions ?? []);
      setAnalyses((await analysisRes.json()).analyses ?? []);
      setSuggestions((await suggestRes.json()).suggestions ?? []);
      setTrades((await tradesRes.json()).trades ?? []);
    } catch {
      setMessage("Dashboard refresh failed. Trading suggestions remain unavailable until data can be verified.");
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!account?.botSettings) {
      return;
    }

    setDraftSpeedLevel(minutesToSpeedLevel(account.botSettings.refreshIntervalMinutes));
    setDraftRiskMultiplier(account.botSettings.riskMultiplier);
  }, [account?.botSettings]);

  useEffect(() => {
    if (!account?.botRunning || killActive) {
      return;
    }

    const timer = window.setInterval(() => {
      void refresh();
    }, account.botSettings.refreshIntervalMs);

    return () => window.clearInterval(timer);
  }, [account?.botRunning, account?.botSettings.refreshIntervalMs, killActive, refresh]);

  async function setBotActive(running: boolean) {
    const response = await fetch("/api/bot-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ running }),
    });
    const payload = await response.json();
    setMessage(payload.error === "KILL_SWITCH_ACTIVE" ? "Cannot start while the kill switch is active." : running ? `Paper bot started. Suggestions refresh every ${payload.settings.refreshIntervalMinutes} minute(s); trades still need manual approval.` : "Paper bot paused.");
    await refresh();
  }

  async function updateBotSettings(settings: { refreshIntervalMinutes?: number; riskMultiplier?: number }) {
    const response = await fetch("/api/bot-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        running: account?.botRunning === true,
        ...settings,
      }),
    });
    const payload = await response.json();
    setMessage(`Bot speed ${payload.settings.refreshIntervalMinutes} minute(s), risk ${payload.settings.riskMultiplier}x.`);
    await refresh();
  }

  function handleSpeedDraft(nextSpeedLevel: number) {
    const clampedSpeed = clamp(nextSpeedLevel, 1, 60);
    const nextMinutes = speedLevelToMinutes(clampedSpeed);
    const nextSpeedMultiplier = calculateSpeedMultiplier(nextMinutes);
    setDraftSpeedLevel(clampedSpeed);
    setDraftRiskMultiplier(nextSpeedMultiplier);
  }

  function commitSpeed(speedLevel = draftSpeedLevel) {
    void updateBotSettings({ refreshIntervalMinutes: speedLevelToMinutes(speedLevel) });
  }

  function commitRisk(riskMultiplier = draftRiskMultiplier) {
    void updateBotSettings({ riskMultiplier });
  }

  async function triggerKillSwitch() {
    await fetch("/api/kill-switch", { method: "POST", body: JSON.stringify({ active: true }) });
    setMessage("Kill switch activated. All new trade activity is halted.");
    await refresh();
  }

  async function clearKillSwitch() {
    const confirmed = window.confirm("Un-halt local paper trading? New suggestions and paper approvals will be allowed again after risk checks.");
    if (!confirmed) {
      return;
    }

    await fetch("/api/kill-switch", { method: "POST", body: JSON.stringify({ active: false }) });
    setMessage("Kill switch cleared. Paper trading activity is available again, subject to risk checks.");
    await refresh();
  }

  async function submitDecision(suggestion: Suggestion, decision: "APPROVE" | "REJECT") {
    if (mode === "live") {
      const confirmed = window.confirm("Confirm manual live-trading approval for this single trade?");
      if (!confirmed) {
        return;
      }
    }

    setBusyId(suggestion.id);
    const response = await fetch("/api/approve-trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision,
        mode,
        symbol: suggestion.symbol,
        action: suggestion.action,
        quantity: suggestion.quantity,
        entryPrice: suggestion.entryPrice,
        stopLoss: suggestion.stopLoss,
        takeProfit: suggestion.takeProfit,
        confidence: suggestion.confidence,
        reasoning: suggestion.reasoning,
        invalidationCondition: suggestion.invalidationCondition,
      }),
    });
    const payload = await response.json();
    setMessage(payload.accepted ? "Trade accepted after risk checks." : "Trade rejected and logged.");
    setBusyId(null);
    await refresh();
  }

  return (
    <main className="min-h-screen bg-[#eef3ef]">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-normal text-ink">trAIde</h1>
            <span
              className={`rounded px-2.5 py-1 text-xs font-bold tracking-normal ${
                mode === "live" ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"
              }`}
            >
              {mode === "live" ? "LIVE TRADING" : "PAPER TRADING"}
            </span>
            <span className="rounded bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
              DATA: {account?.marketDataProvider === "finnhub" ? "FINNHUB" : "MOCK"}
            </span>
            <span className={`rounded px-2.5 py-1 text-xs font-semibold ${botRunning ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
              BOT: {botRunning ? "RUNNING" : "PAUSED"}
            </span>
            {killActive ? (
              <span className="inline-flex items-center gap-1 rounded bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-800">
                <ShieldAlert size={14} /> HALTED
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {botRunning ? (
              <button
                className="inline-flex h-10 items-center gap-2 rounded border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-panel"
                onClick={() => setBotActive(false)}
                title="Pause paper bot refresh loop"
              >
                <Pause size={16} /> Pause
              </button>
            ) : (
              <button
                className="inline-flex h-10 items-center gap-2 rounded bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                onClick={() => setBotActive(true)}
                disabled={killActive}
                title="Start paper bot refresh loop"
              >
                <Play size={16} /> Start
              </button>
            )}
            {liveAllowed ? (
              <div className="grid grid-cols-2 rounded border border-line bg-panel p-1">
                <button
                  className={`rounded px-3 py-2 text-sm font-medium ${mode === "paper" ? "bg-white shadow-panel" : "text-slate-600"}`}
                  onClick={() => setMode("paper")}
                >
                  Paper
                </button>
                <button
                  className={`rounded px-3 py-2 text-sm font-medium ${mode === "live" ? "bg-red-700 text-white shadow-panel" : "text-slate-600"}`}
                  onClick={() => setMode("live")}
                >
                  Live
                </button>
              </div>
            ) : null}
            <button
              className="inline-flex h-10 items-center gap-2 rounded border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
              onClick={triggerKillSwitch}
              disabled={killActive}
              title="Activate global kill switch"
            >
              <Power size={16} /> Kill Switch
            </button>
            {killActive ? (
              <button
                className="inline-flex h-10 items-center gap-2 rounded border border-emerald-200 bg-white px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
                onClick={clearKillSwitch}
                title="Clear local kill switch"
              >
                <ShieldCheck size={16} /> Un-halt
              </button>
            ) : null}
            <button
              className="inline-flex h-10 items-center gap-2 rounded border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-panel"
              onClick={refresh}
              title="Refresh dashboard data"
            >
              <RefreshCw size={16} /> Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-4 md:px-6">
        <div className="mb-4 flex flex-col gap-2 border-l-4 border-warning bg-amber-50 px-4 py-3 text-sm text-amber-900 md:flex-row md:items-center md:justify-between">
          <span>{DISCLAIMER}</span>
          <span>{BACKTEST_DISCLAIMER}</span>
        </div>
        {deploymentWarnings.length ? (
          <div className="mb-4 rounded border border-amber-200 bg-white px-4 py-3 text-sm text-amber-950 shadow-panel">
            <div className="mb-2 flex items-center gap-2 font-semibold text-ink">
              <AlertTriangle size={16} /> Deployment status
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <StatusPill label="Host" value={account?.deployment.host === "vercel" ? "Vercel" : "Local"} good={account?.deployment.host !== "vercel"} />
              <StatusPill label="Finnhub" value={account?.deployment.hasFinnhubKey ? "Connected" : "Missing key"} good={account?.deployment.hasFinnhubKey === true} />
              <StatusPill label="Gemini" value={account?.deployment.hasGeminiKey ? "Connected" : "Missing key"} good={account?.deployment.hasGeminiKey === true} />
            </div>
            <ul className="mt-3 space-y-1">
              {deploymentWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {message ? <div className="mb-4 rounded border border-line bg-white px-4 py-3 text-sm text-ink shadow-panel">{message}</div> : null}

        <div className="grid gap-4 lg:grid-cols-12">
          <Panel title="Account Summary" className="lg:col-span-4">
            <div className="grid grid-cols-2 gap-3">
              <Metric label="Balance" value={money(account?.account.balance)} />
              <Metric label="Equity" value={money(account?.account.equity)} />
              <Metric label="Live PnL" value={money(realizedPnl + unrealizedPnl)} tone={realizedPnl + unrealizedPnl < 0 ? "bad" : "good"} />
              <Metric label="Open Positions" value={String(account?.account.openPositionCount ?? 0)} />
            </div>
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs font-medium text-slate-600">
                <span>Daily loss used</span>
                <span>{percent(account?.account.dailyLossUsedPct ?? 0)} / {money(account?.account.dailyLossLimit)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded bg-slate-200">
                <div className="h-full bg-amber-600" style={{ width: `${Math.min((account?.account.dailyLossUsedPct ?? 0) * 100, 100)}%` }} />
              </div>
            </div>
          </Panel>

          <Panel title="Bot Speed / Risk" className="lg:col-span-8">
            <div className="grid gap-4 md:grid-cols-2">
              <SliderControl
                label="Refresh speed"
                value={draftSpeedLevel}
                min={1}
                max={60}
                step={1}
                display={`${draftRefreshMinutes} min`}
                hint={`Speed multiplier: ${draftSpeedMultiplier}x`}
                minLabel="Slow"
                maxLabel="Fast"
                onChange={handleSpeedDraft}
                onCommit={commitSpeed}
              />
              <SliderControl
                label="Paper risk multiplier"
                value={Math.min(draftRiskMultiplier, draftSpeedMultiplier)}
                min={1}
                max={draftSpeedMultiplier}
                step={0.1}
                display={`${Math.min(draftRiskMultiplier, draftSpeedMultiplier).toFixed(1)}x`}
                hint={`Max rises with speed; effective risk/trade: ${percent(account?.riskConfig.maxRiskPerTradePct ?? 0)}`}
                minLabel="1x"
                maxLabel={`${draftSpeedMultiplier}x`}
                onChange={setDraftRiskMultiplier}
                onCommit={commitRisk}
              />
            </div>
          </Panel>

          <Panel title="Live PnL" className="lg:col-span-8">
            <div className="grid gap-4 md:grid-cols-[1fr_220px]">
              <PnlChart points={pnlSeries} />
              <div className="grid grid-cols-2 gap-3 md:grid-cols-1">
                <Metric label="Realized" value={money(realizedPnl)} tone={realizedPnl < 0 ? "bad" : "good"} />
                <Metric label="Unrealized" value={money(unrealizedPnl)} tone={unrealizedPnl < 0 ? "bad" : "good"} />
                <Metric label="Open Stake" value={money(openStake)} />
                <Metric label="Fees Paid" value={money(totalFees)} tone={totalFees > 0 ? "bad" : undefined} />
              </div>
            </div>
          </Panel>

          <Panel title="Watchlist" className="lg:col-span-4">
            <div className="space-y-2">
              {analyses.map((analysis) => (
                <div key={analysis.symbol} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-line pb-2 last:border-0">
                  <span className="font-semibold">{analysis.symbol}</span>
                  <span className="text-sm text-slate-600">{money(analysis.lastPrice)}</span>
                  <SignalBadge action={analysis.action} />
                </div>
              ))}
              {!analyses.length ? <Empty loading={loading} text="No watchlist data." /> : null}
            </div>
          </Panel>

          <Panel title="Live Buy / Sell Activity" className="lg:col-span-4">
            <div className="space-y-2">
              {activityRows.map((row) => (
                <div key={row.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-line pb-2 last:border-0">
                  <SignalBadge action={row.action} />
                  <div className="min-w-0">
                    <div className="font-semibold text-ink">{row.symbol}</div>
                    <div className="truncate text-xs text-slate-500">{row.label}</div>
                  </div>
                  <div className="text-right text-sm font-semibold text-ink">{money(row.stake)}</div>
                </div>
              ))}
              {!activityRows.length ? <Empty loading={loading} text="No active buys or sells yet." /> : null}
            </div>
          </Panel>

          <Panel title="Risk Settings" className="lg:col-span-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Metric label="Max Risk" value={percent(account?.riskConfig.maxRiskPerTradePct ?? 0)} />
              <Metric label="Daily Loss" value={percent(account?.riskConfig.maxDailyLossPct ?? 0)} />
              <Metric label="Max Positions" value={String(account?.riskConfig.maxOpenPositions ?? 0)} />
              <Metric label="Min Confidence" value={percent(account?.riskConfig.minAIConfidence ?? 0)} />
              <Metric label="Paper Exposure" value={`${account?.riskConfig.paperExposureMultiplier ?? 1}x`} />
              <Metric label="Max Account Risk" value={percent(account?.riskConfig.maxAccountRiskPct ?? 0)} />
              <Metric label="Paper Leverage" value={account?.riskConfig.allowLeverage ? "Allowed" : "Off"} />
              <Metric label="Short Selling" value={account?.riskConfig.allowShortSelling ? "Allowed" : "Off"} />
            </div>
          </Panel>

          <Panel title="Open Positions" className="lg:col-span-7">
            <Table
              columns={["Symbol", "Stake", "Entry", "Current", "Unrealized", "Stop", "Target"]}
              rows={positions.map((position) => [
                `${position.symbol} ${position.side}`,
                money(position.quantity * position.currentPrice),
                money(position.entryPrice),
                money(position.currentPrice),
                money(position.unrealizedPnl),
                money(position.stopLoss),
                money(position.takeProfit),
              ])}
              empty={loading ? "Loading positions." : "No open paper positions."}
            />
          </Panel>

          <Panel title="AI Analysis Feed" className="lg:col-span-5">
            <div className="space-y-3">
              {analyses.map((analysis) => (
                <div key={analysis.symbol} className="border-b border-line pb-3 last:border-0">
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="font-semibold">{analysis.symbol}</span>
                    <span className="text-sm text-slate-600">{percent(analysis.confidence)}</span>
                  </div>
                  <div className="mb-1 flex items-center gap-2">
                    <SignalBadge action={analysis.action} />
                    {analysis.error ? <span className="inline-flex items-center gap-1 text-xs text-red-700"><AlertTriangle size={13} /> {analysis.error}</span> : null}
                  </div>
                  <p className="text-sm text-slate-700">{analysis.reasoning}</p>
                  <p className="mt-1 text-xs text-slate-500">{analysis.invalidation_condition}</p>
                </div>
              ))}
              {!analyses.length ? <Empty loading={loading} text="No analysis yet." /> : null}
            </div>
          </Panel>

          <Panel title="Suggested Trades" className="lg:col-span-12">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase text-slate-500">
                    {["Symbol", "Action", "Size", "Stake", "Entry", "Stop", "Target", "Risk", "Confidence", ""].map((heading) => (
                      <th key={heading} className="py-2 pr-3 font-semibold">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map((suggestion) => (
                    <tr key={suggestion.id} className="border-b border-line last:border-0">
                      <td className="py-2 pr-3 font-semibold">{suggestion.symbol}</td>
                      <td className="py-2 pr-3"><SignalBadge action={suggestion.action} /></td>
                      <td className="py-2 pr-3">{suggestion.quantity.toFixed(4)}</td>
                      <td className="py-2 pr-3">{money(suggestion.quantity * suggestion.entryPrice)}</td>
                      <td className="py-2 pr-3">{money(suggestion.entryPrice)}</td>
                      <td className="py-2 pr-3">{money(suggestion.stopLoss)}</td>
                      <td className="py-2 pr-3">{money(suggestion.takeProfit)}</td>
                      <td className="py-2 pr-3">{money(suggestion.riskAmount)}</td>
                      <td className="py-2 pr-3">{percent(suggestion.confidence)}</td>
                      <td className="py-2 pr-0">
                        <div className="flex justify-end gap-2">
                          <button
                            className="inline-flex h-9 items-center gap-1 rounded bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-60"
                            disabled={busyId === suggestion.id || killActive}
                            onClick={() => submitDecision(suggestion, "APPROVE")}
                            title="Approve this trade"
                          >
                            <Check size={15} /> Approve
                          </button>
                          <button
                            className="inline-flex h-9 items-center gap-1 rounded border border-line bg-white px-3 text-sm font-semibold text-ink"
                            disabled={busyId === suggestion.id}
                            onClick={() => submitDecision(suggestion, "REJECT")}
                            title="Reject this trade"
                          >
                            <X size={15} /> Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!suggestions.length ? <Empty loading={loading} text="No trades currently pass risk checks." /> : null}
              <div className="mt-3 text-xs text-slate-500">Suggested stake waiting for approval: {money(suggestedStake)}. Paper fee: $1 on open and $1 on close.</div>
            </div>
          </Panel>

          <Panel title="All Moves" className="lg:col-span-12">
            <div className="max-h-[520px] overflow-y-auto pr-1">
              <div className="space-y-2">
                {allMoves.map((move) => (
                  <div key={move.id} className="grid gap-3 border-b border-line pb-3 last:border-0 md:grid-cols-[160px_110px_1fr_130px_110px] md:items-center">
                    <div className="text-xs text-slate-500">{move.time}</div>
                    <MoveBadge type={move.type} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink">{move.symbol}</span>
                        {move.action ? <SignalBadge action={move.action} /> : null}
                        {typeof move.confidence === "number" ? <span className="text-xs text-slate-500">{percent(move.confidence)} confidence</span> : null}
                      </div>
                      <div className="mt-1 truncate text-sm text-slate-600">{move.reason}</div>
                    </div>
                    <div className="text-sm text-slate-700">
                      <div>Stake {money(move.stake)}</div>
                      {typeof move.fee === "number" && move.fee > 0 ? <div className="text-xs text-slate-500">Fee {money(move.fee)}</div> : null}
                    </div>
                    <div className={move.pnl && move.pnl < 0 ? "text-sm font-semibold text-red-700" : "text-sm font-semibold text-emerald-700"}>
                      {typeof move.pnl === "number" ? money(move.pnl) : "-"}
                    </div>
                  </div>
                ))}
                {!allMoves.length ? <Empty loading={loading} text="No bot moves yet." /> : null}
              </div>
            </div>
          </Panel>

          <Panel title="Trade Log" className="lg:col-span-12">
            <Table
              columns={["Time", "Symbol", "Action", "Size", "Stake", "Entry", "Exit", "PnL", "Fee", "Status", "Reason"]}
              rows={trades.map((trade) => [
                new Date(trade.timestamp).toLocaleString(),
                trade.symbol,
                trade.action,
                trade.quantity ? trade.quantity.toFixed(4) : "-",
                trade.quantity ? money(trade.quantity * trade.entry_price) : "-",
                money(trade.entry_price),
                trade.close_price ? money(trade.close_price) : "-",
                trade.pnl === null ? "-" : money(trade.pnl),
                money(trade.fee_approx),
                trade.status,
                trade.rejection_reason ?? trade.notes ?? "-",
              ])}
              empty={loading ? "Loading trades." : "No paper trades logged yet."}
            />
          </Panel>
        </div>
      </div>
    </main>
  );
}

function PnlChart({ points }: { points: Array<{ label: string; value: number }> }) {
  if (!points.length) {
    return <Empty loading={false} text="PnL graph appears after paper trades are opened or closed." />;
  }

  const width = 720;
  const height = 220;
  const padding = 24;
  const values = points.map((point) => point.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = Math.max(max - min, 1);
  const step = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const coords = points.map((point, index) => {
    const x = padding + index * step;
    const y = height - padding - ((point.value - min) / span) * (height - padding * 2);
    return { x, y };
  });
  const line = coords.map((coord) => `${coord.x},${coord.y}`).join(" ");
  const zeroY = height - padding - ((0 - min) / span) * (height - padding * 2);
  const latest = points[points.length - 1].value;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="inline-flex items-center gap-2 font-semibold text-ink"><Activity size={16} /> Paper PnL curve</span>
        <span className={latest < 0 ? "font-semibold text-red-700" : "font-semibold text-emerald-700"}>{money(latest)}</span>
      </div>
      <svg className="h-[220px] w-full rounded border border-line bg-panel" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Paper PnL graph">
        <line x1={padding} y1={zeroY} x2={width - padding} y2={zeroY} stroke="#94a3b8" strokeDasharray="4 4" />
        <polyline fill="none" stroke={latest < 0 ? "#b91c1c" : "#0f766e"} strokeWidth="3" points={line} />
        {coords.map((coord, index) => (
          <circle key={`${coord.x}-${coord.y}-${index}`} cx={coord.x} cy={coord.y} r="3" fill={points[index].value < 0 ? "#b91c1c" : "#0f766e"} />
        ))}
      </svg>
      <div className="mt-2 flex justify-between text-xs text-slate-500">
        <span>{points[0].label}</span>
        <span>{points[points.length - 1].label}</span>
      </div>
    </div>
  );
}

function buildPnlSeries(trades: Trade[], unrealizedPnl: number): Array<{ label: string; value: number }> {
  const chronological = [...trades]
    .filter((trade) => trade.status.startsWith("CLOSED") && typeof trade.pnl === "number")
    .reverse();
  let cumulative = 0;
  const points = chronological.map((trade) => {
    cumulative += trade.pnl ?? 0;
    return {
      label: new Date(trade.timestamp).toLocaleTimeString(),
      value: Number(cumulative.toFixed(2)),
    };
  });

  if (unrealizedPnl !== 0 || points.length) {
    points.push({ label: "Live", value: Number((cumulative + unrealizedPnl).toFixed(2)) });
  }

  return points;
}

function buildActivityRows(suggestions: Suggestion[], positions: Position[], trades: Trade[]) {
  const suggested = suggestions.slice(0, 5).map((suggestion) => ({
    id: `suggestion-${suggestion.id}`,
    action: suggestion.action,
    symbol: suggestion.symbol,
    label: `Suggested stake, awaiting approval`,
    stake: suggestion.quantity * suggestion.entryPrice,
  }));
  const open = positions.slice(0, 5).map((position) => ({
    id: `position-${position.id}`,
    action: position.side === "LONG" ? "BUY" as const : "SELL" as const,
    symbol: position.symbol,
    label: `Open ${position.side.toLowerCase()} position`,
    stake: position.quantity * position.currentPrice,
  }));
  const recent = trades
    .filter((trade) => trade.action === "BUY" || trade.action === "SELL")
    .slice(0, 5)
    .map((trade) => ({
      id: `trade-${trade.id}`,
      action: trade.action as "BUY" | "SELL",
      symbol: trade.symbol,
      label: trade.status,
      stake: trade.quantity * trade.entry_price,
    }));

  return [...suggested, ...open, ...recent].slice(0, 8);
}

type MoveType = "SUGGESTED" | "OPEN" | "CLOSED" | "REJECTED" | "ANALYSIS";

type Move = {
  id: string;
  timestampMs: number;
  time: string;
  type: MoveType;
  symbol: string;
  action?: "BUY" | "SELL" | "HOLD";
  stake?: number;
  pnl?: number;
  fee?: number;
  confidence?: number;
  reason: string;
};

function buildAllMoves(suggestions: Suggestion[], positions: Position[], analyses: Analysis[], trades: Trade[]): Move[] {
  const now = Date.now();
  const moves: Move[] = [];

  for (const suggestion of suggestions) {
    moves.push({
      id: `suggestion-${suggestion.id}`,
      timestampMs: now,
      time: "Now",
      type: "SUGGESTED",
      symbol: suggestion.symbol,
      action: suggestion.action,
      stake: suggestion.quantity * suggestion.entryPrice,
      confidence: suggestion.confidence,
      reason: `Risk passed. ${suggestion.reasoning}`,
    });
  }

  for (const position of positions) {
    moves.push({
      id: `position-${position.id}`,
      timestampMs: new Date(position.openedAt).getTime(),
      time: formatMoveTime(position.openedAt),
      type: "OPEN",
      symbol: position.symbol,
      action: position.side === "LONG" ? "BUY" : "SELL",
      stake: position.quantity * position.currentPrice,
      pnl: position.unrealizedPnl,
      reason: `Open ${position.side.toLowerCase()} position. Stop ${money(position.stopLoss)}, target ${money(position.takeProfit)}.`,
    });
  }

  for (const trade of trades) {
    const type: MoveType = trade.status === "REJECTED" ? "REJECTED" : trade.status.startsWith("CLOSED") ? "CLOSED" : "OPEN";
    moves.push({
      id: `trade-${trade.id}`,
      timestampMs: new Date(trade.timestamp).getTime(),
      time: formatMoveTime(trade.timestamp),
      type,
      symbol: trade.symbol,
      action: trade.action === "BUY" || trade.action === "SELL" || trade.action === "HOLD" ? trade.action : undefined,
      stake: trade.quantity * trade.entry_price,
      pnl: trade.pnl ?? undefined,
      fee: trade.fee_approx,
      confidence: trade.ai_confidence ?? undefined,
      reason: trade.rejection_reason ?? trade.notes ?? trade.status,
    });
  }

  for (const analysis of analyses) {
    moves.push({
      id: `analysis-${analysis.symbol}`,
      timestampMs: now - 1,
      time: "Now",
      type: "ANALYSIS",
      symbol: analysis.symbol,
      action: analysis.action,
      stake: analysis.lastPrice,
      confidence: analysis.confidence,
      reason: analysis.error ? `Analysis error: ${analysis.error}` : analysis.reasoning,
    });
  }

  return moves
    .filter((move) => Number.isFinite(move.timestampMs))
    .sort((a, b) => b.timestampMs - a.timestampMs)
    .slice(0, 100);
}

function formatMoveTime(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return parsed.toLocaleString();
}

function MoveBadge({ type }: { type: MoveType }) {
  const styles: Record<MoveType, string> = {
    SUGGESTED: "bg-blue-100 text-blue-800",
    OPEN: "bg-emerald-100 text-emerald-800",
    CLOSED: "bg-slate-100 text-slate-800",
    REJECTED: "bg-red-100 text-red-800",
    ANALYSIS: "bg-amber-100 text-amber-900",
  };

  return (
    <span className={`inline-flex w-fit items-center gap-1 rounded px-2 py-1 text-xs font-bold ${styles[type]}`}>
      <ListChecks size={13} /> {type}
    </span>
  );
}

function minutesToSpeedLevel(minutes: number): number {
  return 61 - clamp(Math.round(minutes), 1, 60);
}

function speedLevelToMinutes(speedLevel: number): number {
  return 61 - clamp(Math.round(speedLevel), 1, 60);
}

function calculateSpeedMultiplier(refreshIntervalMinutes: number): number {
  return Math.round((1 + ((60 - refreshIntervalMinutes) / 59) * 4) * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded border border-line bg-white p-4 shadow-panel ${className}`}>
      <h2 className="mb-3 text-base font-semibold tracking-normal text-ink">{title}</h2>
      {children}
    </section>
  );
}

function SliderControl({
  label,
  value,
  min,
  max,
  step,
  display,
  hint,
  minLabel,
  maxLabel,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  hint: string;
  minLabel: string;
  maxLabel: string;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const sliderValue = Math.min(value, max);

  return (
    <div className="min-w-0 border-b border-line pb-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <label className="text-sm font-semibold text-ink">{label}</label>
        <span className="rounded bg-panel px-2 py-1 text-xs font-bold text-ink">{display}</span>
      </div>
      <input
        className="h-2 w-full accent-emerald-700"
        type="range"
        min={min}
        max={max}
        step={step}
        value={sliderValue}
        onChange={(event) => onChange(Number(event.target.value))}
        onMouseUp={(event) => onCommit(Number(event.currentTarget.value))}
        onTouchEnd={(event) => onCommit(Number(event.currentTarget.value))}
        onKeyUp={(event) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            onCommit(Number(event.currentTarget.value));
          }
        }}
      />
      <div className="mt-2 flex justify-between text-xs text-slate-500">
        <span>{minLabel}</span>
        <span>{hint}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="min-w-0 border-b border-line pb-2">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : "text-ink"}`}>{value}</div>
    </div>
  );
}

function StatusPill({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded border border-line bg-panel px-3 py-2">
      <span className="text-xs font-semibold uppercase text-slate-500">{label}</span>
      <span className={`rounded px-2 py-1 text-xs font-bold ${good ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>{value}</span>
    </div>
  );
}

function SignalBadge({ action }: { action: "BUY" | "SELL" | "HOLD" }) {
  const styles = {
    BUY: "bg-emerald-100 text-emerald-800",
    SELL: "bg-red-100 text-red-800",
    HOLD: "bg-slate-100 text-slate-700",
  };

  return <span className={`rounded px-2 py-1 text-xs font-bold ${styles[action]}`}>{action}</span>;
}

function Table({ columns, rows, empty }: { columns: string[]; rows: string[][]; empty: string }) {
  if (!rows.length) {
    return <Empty loading={false} text={empty} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase text-slate-500">
            {columns.map((column) => (
              <th key={column} className="py-2 pr-3 font-semibold">{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-line last:border-0">
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`} className="py-2 pr-3 align-top text-slate-700">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ loading, text }: { loading: boolean; text: string }) {
  return <div className="rounded border border-dashed border-line bg-panel px-3 py-6 text-center text-sm text-slate-500">{loading ? "Loading." : text}</div>;
}

function money(value: number | undefined | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value > 1000 ? 0 : 2 }).format(value);
}

function percent(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return `${(value * 100).toFixed(1)}%`;
}
