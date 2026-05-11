"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Check, ListChecks, Loader2, Pause, Play, Power, RefreshCw, RotateCcw, ShieldAlert, ShieldCheck, X } from "lucide-react";

type Mode = "paper" | "live";
type ControlAction = "bot" | "refresh" | "kill" | "unhalt" | "settings" | "reset" | null;
type NoticeTone = "info" | "success" | "warning" | "danger";

type AccountResponse = {
  marketDataProvider: "finnhub" | "mock-etoro";
  liveTradingEnabled: boolean;
  autoPaperTradingEnabled: boolean;
  killSwitchActive: boolean;
  botRunning: boolean;
  botSettings: {
    refreshIntervalMinutes: number;
    refreshIntervalMs: number;
    speedMultiplier: number;
    riskMultiplier: number;
  };
  session: {
    cryptoOnly: boolean;
    label: "REGULAR_ASSET_SCAN" | "WEEKEND_CRYPTO_ONLY";
    reason: string;
  };
  deployment: {
    host: "local" | "vercel";
    hasFinnhubKey: boolean;
    hasGeminiKey: boolean;
    storage: "local-sqlite" | "ephemeral-sqlite" | "supabase";
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
  source?: string;
  scannerScore?: number;
};

type Opportunity = {
  symbol: string;
  source: "NEWS" | "VOLATILITY" | "DROP_BOUNCE" | "MOCK";
  score: number;
  lastPrice: number;
  priceChangePct: number;
  volatilityPct: number;
  recentMovePct?: number;
  rsi2?: number;
  rsi14?: number;
  atrPct?: number;
  trendPct?: number;
  regime?: string;
  cryptoOnlySession?: boolean;
  headline?: string;
  reason: string;
  generatedAt: string;
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
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [fastLoading, setFastLoading] = useState(false);
  const [slowLoading, setSlowLoading] = useState(false);
  const [controlBusy, setControlBusy] = useState<ControlAction>(null);
  const [botTarget, setBotTarget] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: NoticeTone } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [uiTick, setUiTick] = useState(0);
  const [draftSpeedLevel, setDraftSpeedLevel] = useState(1);
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
  const botBadgeLabel = controlBusy === "bot"
    ? botTarget ? "STARTING..." : "PAUSING..."
    : botRunning ? "RUNNING" : "PAUSED";
  const deploymentWarnings = (account?.deployment.warnings ?? []).filter((warning) => {
    const isPausedWarning = warning.toLowerCase().includes("bot is paused");
    return !(isPausedWarning && (botRunning || (controlBusy === "bot" && botTarget === true)));
  });
  const draftRefreshSeconds = speedLevelToSeconds(draftSpeedLevel);
  const draftSpeedMultiplier = calculateSpeedMultiplier(draftRefreshSeconds);
  const localHeartbeat = useMemo(() => new Date().toLocaleTimeString(), [uiTick]);
  const actionCopy = getActionCopy(controlBusy, botTarget, fastLoading, slowLoading, loading);

  function showNotice(text: string, tone: NoticeTone = "info") {
    setNotice({ text, tone });
  }

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => {
      setNotice(null);
    }, 4500);

    return () => window.clearTimeout(timer);
  }, [notice]);

  const refreshFastData = useCallback(async (showLoading = false) => {
    if (showLoading) {
      setFastLoading(true);
    }

    try {
      const [accountRes, positionsRes, tradesRes] = await Promise.all([
        fetch("/api/account", { cache: "no-store" }),
        fetch("/api/positions", { cache: "no-store" }),
        fetch("/api/paper-trades", { cache: "no-store" }),
      ]);

      if (!accountRes.ok || !positionsRes.ok || !tradesRes.ok) {
        throw new Error("Fast refresh failed");
      }

      setAccount(await accountRes.json());
      setPositions((await positionsRes.json()).positions ?? []);
      setTrades((await tradesRes.json()).trades ?? []);
    } catch {
      setMessage("Fast dashboard refresh failed. Positions and account data may be stale.");
    } finally {
      if (showLoading) {
        setFastLoading(false);
      }
    }
  }, []);

  const refreshSlowData = useCallback(async (showLoading = false) => {
    if (showLoading) {
      setSlowLoading(true);
    }

    try {
      const [analysisRes, opportunitiesRes, suggestRes] = await Promise.all([
        fetch("/api/analysis", { cache: "no-store" }),
        fetch("/api/opportunities", { cache: "no-store" }),
        fetch(`/api/suggest?mode=${mode}`, { cache: "no-store" }),
      ]);

      if (!analysisRes.ok || !opportunitiesRes.ok || !suggestRes.ok) {
        throw new Error("Strategy refresh failed");
      }

      setAnalyses((await analysisRes.json()).analyses ?? []);
      setOpportunities((await opportunitiesRes.json()).opportunities ?? []);
      setSuggestions((await suggestRes.json()).suggestions ?? []);
    } catch {
      setMessage("Strategy refresh failed. Suggestions remain unavailable until data can be verified.");
    } finally {
      if (showLoading) {
        setSlowLoading(false);
      }
    }
  }, [mode]);

  const refresh = useCallback(async (manual = false) => {
    setLoading(true);
    if (manual) {
      setControlBusy("refresh");
      setMessage("Refreshing dashboard data...");
      showNotice("Refresh pressed. Pulling account, trades, AI, and scanner data.", "info");
    }

    try {
      await Promise.all([refreshFastData(manual), refreshSlowData(manual)]);
      if (manual) {
        setMessage("Dashboard refreshed. API calls stayed rate-limited.");
        showNotice("Dashboard refresh complete.", "success");
      }
    } finally {
      setLoading(false);
      if (manual) {
        setControlBusy(null);
      }
    }
  }, [refreshFastData, refreshSlowData]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setUiTick((tick) => tick + 1);
    }, 100);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh();
    }, 60_000);

    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!account?.botSettings) {
      return;
    }

    setDraftSpeedLevel(secondsToSpeedLevel(account.botSettings.refreshIntervalMinutes));
    setDraftRiskMultiplier(account.botSettings.riskMultiplier);
  }, [account?.botSettings]);

  useEffect(() => {
    if (!account?.botRunning || killActive) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshFastData();
    }, 2000);

    return () => window.clearInterval(timer);
  }, [account?.botRunning, killActive, refreshFastData]);

  useEffect(() => {
    if (!account?.botRunning || killActive) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshSlowData();
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [account?.botRunning, killActive, refreshSlowData]);

  async function setBotActive(running: boolean) {
    setControlBusy("bot");
    setBotTarget(running);
    setMessage(running ? "Starting paper bot..." : "Pausing paper bot...");
    showNotice(running ? "Start pressed. Waking the paper bot now." : "Pause pressed. Stopping the paper loop.", "info");

    try {
      const response = await fetch("/api/bot-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ running }),
      });
      const payload = await response.json();
      const autoPaper = account?.autoPaperTradingEnabled === true;

      if (!response.ok || payload.error === "KILL_SWITCH_ACTIVE") {
        setMessage("Cannot start while the kill switch is active.");
        showNotice("Start blocked by the kill switch.", "danger");
        await refreshFastData(true);
        return;
      }

      setAccount((current) => current ? {
        ...current,
        botRunning: payload.running,
        killSwitchActive: payload.killSwitchActive,
        botSettings: payload.settings,
      } : current);
      setMessage(running ? `Paper bot started. Suggestions refresh every ${payload.settings.refreshIntervalMinutes} second(s)${autoPaper ? " and eligible paper trades open automatically after risk checks." : "; trades still need manual approval."}` : "Paper bot paused.");
      showNotice(running ? "Paper bot is running." : "Paper bot paused.", running ? "success" : "warning");
      await refreshFastData(true);
      if (running) {
        void refreshSlowData(true);
      }
    } catch {
      setMessage(running ? "Start failed. Bot state could not be saved." : "Pause failed. Bot state could not be saved.");
      showNotice(running ? "Start failed." : "Pause failed.", "danger");
    } finally {
      setControlBusy(null);
      setBotTarget(null);
    }
  }

  async function updateBotSettings(settings: { refreshIntervalMinutes?: number; riskMultiplier?: number }) {
    setControlBusy("settings");
    setMessage("Saving bot settings...");
    showNotice("Saving bot settings.", "info");

    try {
      const response = await fetch("/api/bot-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          running: account?.botRunning === true,
          ...settings,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error("Settings update failed");
      }

      setMessage(`Bot speed ${payload.settings.refreshIntervalMinutes} second(s), risk ${payload.settings.riskMultiplier}x.`);
      showNotice("Bot settings saved.", "success");
      await refreshFastData(true);
    } catch {
      setMessage("Could not save bot settings.");
      showNotice("Could not save bot settings.", "danger");
    } finally {
      setControlBusy(null);
    }
  }

  function handleSpeedDraft(nextSpeedLevel: number) {
    const clampedSpeed = clamp(nextSpeedLevel, 1, 60);
    const nextSeconds = speedLevelToSeconds(clampedSpeed);
    const nextSpeedMultiplier = calculateSpeedMultiplier(nextSeconds);
    setDraftSpeedLevel(clampedSpeed);
    setDraftRiskMultiplier(nextSpeedMultiplier);
  }

  function commitSpeed(speedLevel = draftSpeedLevel) {
    void updateBotSettings({ refreshIntervalMinutes: speedLevelToSeconds(speedLevel) });
  }

  function commitRisk(riskMultiplier = draftRiskMultiplier) {
    void updateBotSettings({ riskMultiplier });
  }

  async function triggerKillSwitch() {
    const confirmed = window.confirm("Activate the kill switch and halt all new paper activity?");
    if (!confirmed) {
      setMessage("Kill switch cancelled.");
      showNotice("Kill switch cancelled.", "warning");
      return;
    }

    setControlBusy("kill");
    setMessage("Activating kill switch...");
    showNotice("Kill switch pressed. Halting activity.", "danger");

    try {
      await fetch("/api/kill-switch", { method: "POST", body: JSON.stringify({ active: true }) });
      setMessage("Kill switch activated. All new trade activity is halted.");
      showNotice("Kill switch active.", "danger");
      await refreshFastData(true);
    } catch {
      setMessage("Kill switch request failed.");
      showNotice("Kill switch request failed.", "danger");
    } finally {
      setControlBusy(null);
    }
  }

  async function clearKillSwitch() {
    const confirmed = window.confirm("Un-halt local paper trading? New suggestions and paper approvals will be allowed again after risk checks.");
    if (!confirmed) {
      setMessage("Un-halt cancelled.");
      showNotice("Un-halt cancelled.", "warning");
      return;
    }

    setControlBusy("unhalt");
    setMessage("Clearing kill switch...");
    showNotice("Un-halt pressed. Clearing kill switch.", "info");

    try {
      await fetch("/api/kill-switch", { method: "POST", body: JSON.stringify({ active: false }) });
      setMessage("Kill switch cleared. Paper trading activity is available again, subject to risk checks.");
      showNotice("Kill switch cleared.", "success");
      await refreshFastData(true);
      void refreshSlowData(true);
    } catch {
      setMessage("Un-halt request failed.");
      showNotice("Un-halt failed.", "danger");
    } finally {
      setControlBusy(null);
    }
  }

  async function resetPaperAccount() {
    const confirmed = window.confirm("Reset the paper simulation to $100,000 and clear all paper trades? This cannot be undone.");
    if (!confirmed) {
      setMessage("Paper reset cancelled.");
      showNotice("Paper reset cancelled.", "warning");
      return;
    }

    setControlBusy("reset");
    setMessage("Resetting paper simulation to $100,000...");
    showNotice("Reset pressed. Clearing paper portfolio.", "warning");

    try {
      const response = await fetch("/api/reset-paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "RESET_PAPER", startingBalance: 100_000 }),
      });

      if (!response.ok) {
        throw new Error("Paper reset failed");
      }

      setPositions([]);
      setSuggestions([]);
      setTrades([]);
      setMessage("Paper simulation reset to $100,000. Bot is paused and old paper trades were cleared.");
      showNotice("Portfolio reset to $100,000.", "success");
      await refreshFastData(true);
      void refreshSlowData(true);
    } catch {
      setMessage("Paper reset failed. Nothing was changed.");
      showNotice("Paper reset failed.", "danger");
    } finally {
      setControlBusy(null);
    }
  }

  async function submitDecision(suggestion: Suggestion, decision: "APPROVE" | "REJECT") {
    if (mode === "live") {
      const confirmed = window.confirm("Confirm manual live-trading approval for this single trade?");
      if (!confirmed) {
        return;
      }
    }

    setBusyId(suggestion.id);
    setMessage(decision === "APPROVE" ? `Approving ${suggestion.symbol}...` : `Rejecting ${suggestion.symbol}...`);
    showNotice(decision === "APPROVE" ? `Approve pressed for ${suggestion.symbol}.` : `Reject pressed for ${suggestion.symbol}.`, "info");

    try {
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
      showNotice(payload.accepted ? "Trade accepted after risk checks." : "Trade rejected and logged.", payload.accepted ? "success" : "warning");
      await refreshFastData(true);
      void refreshSlowData(true);
    } catch {
      setMessage("Trade decision failed. Nothing was changed.");
      showNotice("Trade decision failed.", "danger");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#eef3ef]">
      {loading && !account ? <LoadingScreen /> : null}
      {actionCopy ? <ActionOverlay copy={actionCopy} /> : null}
      {notice ? <ActionNotice notice={notice} onClose={() => setNotice(null)} /> : null}
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
            {account?.session.cryptoOnly ? (
              <span className="rounded bg-indigo-100 px-2.5 py-1 text-xs font-semibold text-indigo-800">
                SESSION: CRYPTO WEEKEND
              </span>
            ) : null}
            {account?.autoPaperTradingEnabled ? (
              <span className="rounded bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                AUTO PAPER
              </span>
            ) : null}
            <span className={`rounded px-2.5 py-1 text-xs font-semibold ${controlBusy === "bot" ? "animate-pulse bg-amber-100 text-amber-900" : botRunning ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
              BOT: {botBadgeLabel}
            </span>
            <span className="rounded bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
              UI refresh: 100ms
            </span>
            <span className="rounded bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
              Market/API refresh: rate-limited
            </span>
            <span className="rounded bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-500">
              Local tick {localHeartbeat}
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
                className={`inline-flex h-10 items-center gap-2 rounded border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-panel disabled:opacity-60 ${controlBusy === "bot" ? "ring-2 ring-amber-300" : ""}`}
                onClick={() => setBotActive(false)}
                disabled={controlBusy === "bot"}
                title="Pause paper bot refresh loop"
              >
                {controlBusy === "bot" ? <ButtonSpinner /> : <Pause size={16} />} {controlBusy === "bot" ? "Pausing..." : "Pause"}
              </button>
            ) : (
              <button
                className={`inline-flex h-10 items-center gap-2 rounded bg-emerald-700 px-4 text-sm font-semibold text-white shadow-panel hover:bg-emerald-800 disabled:opacity-60 ${controlBusy === "bot" ? "animate-pulse ring-4 ring-emerald-200" : ""}`}
                onClick={() => setBotActive(true)}
                disabled={killActive || controlBusy === "bot"}
                title="Start paper bot refresh loop"
              >
                {controlBusy === "bot" ? <ButtonSpinner /> : <Play size={16} />} {controlBusy === "bot" ? "Starting..." : "Start"}
              </button>
            )}
            {liveAllowed ? (
              <div className="grid grid-cols-2 rounded border border-line bg-panel p-1">
                <button
                  className={`rounded px-3 py-2 text-sm font-medium ${mode === "paper" ? "bg-white shadow-panel" : "text-slate-600"}`}
                  onClick={() => {
                    setMode("paper");
                    setMessage("Paper mode selected.");
                  }}
                >
                  Paper
                </button>
                <button
                  className={`rounded px-3 py-2 text-sm font-medium ${mode === "live" ? "bg-red-700 text-white shadow-panel" : "text-slate-600"}`}
                  onClick={() => {
                    setMode("live");
                    setMessage("Live mode selected. Every live trade still requires manual approval.");
                  }}
                >
                  Live
                </button>
              </div>
            ) : null}
            <button
              className="inline-flex h-10 items-center gap-2 rounded border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
              onClick={triggerKillSwitch}
              disabled={killActive || controlBusy === "kill"}
              title="Activate global kill switch"
            >
              {controlBusy === "kill" ? <ButtonSpinner /> : <Power size={16} />} {controlBusy === "kill" ? "Halting..." : "Kill Switch"}
            </button>
            {killActive ? (
              <button
                className="inline-flex h-10 items-center gap-2 rounded border border-emerald-200 bg-white px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                onClick={clearKillSwitch}
                disabled={controlBusy === "unhalt"}
                title="Clear local kill switch"
              >
                {controlBusy === "unhalt" ? <ButtonSpinner /> : <ShieldCheck size={16} />} {controlBusy === "unhalt" ? "Un-halting..." : "Un-halt"}
              </button>
            ) : null}
            <button
              className="inline-flex h-10 items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 text-sm font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-60"
              onClick={resetPaperAccount}
              disabled={controlBusy === "reset"}
              title="Reset paper account to $100,000 and clear paper trades"
            >
              {controlBusy === "reset" ? <ButtonSpinner /> : <RotateCcw size={16} />} {controlBusy === "reset" ? "Resetting..." : "Reset to $100k"}
            </button>
            <button
              className="inline-flex h-10 items-center gap-2 rounded border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-panel disabled:opacity-60"
              onClick={() => refresh(true)}
              disabled={controlBusy === "refresh"}
              title="Refresh dashboard data"
            >
              <RefreshCw size={16} className={controlBusy === "refresh" ? "animate-spin" : ""} /> {controlBusy === "refresh" ? "Refreshing..." : "Refresh"}
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
        {loading || fastLoading || slowLoading || controlBusy ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded border border-line bg-white px-4 py-3 text-sm text-slate-700 shadow-panel">
            <Loader2 size={16} className="animate-spin text-emerald-700" />
            {controlBusy ? <span>Action in progress.</span> : null}
            {loading ? <span>Dashboard loading.</span> : null}
            {fastLoading ? <span>Account, positions, and trades updating.</span> : null}
            {slowLoading ? <span>AI, scanner, and suggestions updating.</span> : null}
          </div>
        ) : null}

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
                display={`${draftRefreshSeconds} sec`}
                hint={`Speed multiplier: ${draftSpeedMultiplier}x`}
                minLabel="1 sec"
                maxLabel="60 sec"
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

          <Panel title="Opportunity Scanner" className="lg:col-span-8">
            <div className="space-y-2">
              {opportunities.map((opportunity) => (
                <div key={`${opportunity.symbol}-${opportunity.source}`} className="grid gap-3 border-b border-line pb-2 last:border-0 md:grid-cols-[110px_110px_1fr_110px_110px] md:items-center">
                  <div>
                    <div className="font-semibold text-ink">{opportunity.symbol}</div>
                    <div className="text-xs text-slate-500">{money(opportunity.lastPrice)}</div>
                  </div>
                  <MoveBadge type={opportunity.source === "DROP_BOUNCE" ? "SCALP" : opportunity.source} />
                  <div className="min-w-0">
                    <div className="truncate text-sm text-slate-700">{opportunity.reason}</div>
                    <div className="truncate text-xs text-slate-500">
                      {opportunity.regime ? `Regime ${opportunity.regime}` : "Regime unconfirmed"}
                      {typeof opportunity.rsi2 === "number" ? `, RSI-2 ${opportunity.rsi2}` : ""}
                      {typeof opportunity.atrPct === "number" ? `, ATR ${percent(opportunity.atrPct)}` : ""}
                    </div>
                    {opportunity.headline ? <div className="truncate text-xs text-slate-500">{opportunity.headline}</div> : null}
                  </div>
                  <div className={opportunity.priceChangePct < 0 ? "text-sm font-semibold text-red-700" : "text-sm font-semibold text-emerald-700"}>
                    {percent(opportunity.priceChangePct)}
                  </div>
                  <div className="text-sm font-semibold text-ink">Score {opportunity.score}</div>
                </div>
              ))}
              {!opportunities.length ? <Empty loading={loading} text="No scanner candidates yet." /> : null}
            </div>
            <div className="mt-3 text-xs text-slate-500">
              {account?.session.cryptoOnly ? "Weekend/off-session mode is active: new scanner ideas are crypto-only. " : ""}
              Scanner uses news, volatility, RSI, ATR, and regime filters to find paper-trading candidates. It is not a profit guarantee.
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
              <table className="w-full min-w-[1080px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase text-slate-500">
                    {["Symbol", "Source", "Action", "Size", "Stake", "Entry", "Stop", "Target", "Risk", "Confidence", ""].map((heading) => (
                      <th key={heading} className="py-2 pr-3 font-semibold">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map((suggestion) => (
                    <tr key={suggestion.id} className="border-b border-line last:border-0">
                      <td className="py-2 pr-3 font-semibold">{suggestion.symbol}</td>
                      <td className="py-2 pr-3 text-xs font-semibold text-slate-600">{suggestion.source ?? "WATCHLIST"}{suggestion.scannerScore ? ` ${suggestion.scannerScore}` : ""}</td>
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
                            {busyId === suggestion.id ? <ButtonSpinner /> : <Check size={15} />} {busyId === suggestion.id ? "Working..." : "Approve"}
                          </button>
                          <button
                            className="inline-flex h-9 items-center gap-1 rounded border border-line bg-white px-3 text-sm font-semibold text-ink disabled:opacity-60"
                            disabled={busyId === suggestion.id}
                            onClick={() => submitDecision(suggestion, "REJECT")}
                            title="Reject this trade"
                          >
                            {busyId === suggestion.id ? <ButtonSpinner /> : <X size={15} />} {busyId === suggestion.id ? "Working..." : "Reject"}
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

function LoadingScreen() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#eef3ef]/95 px-4">
      <div className="w-full max-w-sm rounded border border-line bg-white p-5 text-center shadow-panel">
        <Loader2 size={34} className="mx-auto animate-spin text-emerald-700" />
        <div className="mt-3 text-base font-semibold text-ink">Loading trAIde</div>
        <div className="mt-1 text-sm text-slate-600">Fetching account, paper trades, and market status.</div>
        <div className="mt-4 h-2 overflow-hidden rounded bg-slate-100">
          <div className="h-full w-1/2 animate-pulse rounded bg-emerald-600" />
        </div>
      </div>
    </div>
  );
}

function ActionOverlay({ copy }: { copy: { title: string; detail: string; tone: NoticeTone } }) {
  const toneStyles: Record<NoticeTone, string> = {
    info: "border-blue-200 bg-blue-50 text-blue-950",
    success: "border-emerald-200 bg-emerald-50 text-emerald-950",
    warning: "border-amber-200 bg-amber-50 text-amber-950",
    danger: "border-red-200 bg-red-50 text-red-950",
  };

  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-40 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2">
      <div className={`flex items-center gap-3 rounded border px-4 py-3 shadow-panel ${toneStyles[copy.tone]}`}>
        <Loader2 size={18} className="animate-spin shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-bold">{copy.title}</div>
          <div className="text-xs opacity-80">{copy.detail}</div>
        </div>
      </div>
    </div>
  );
}

function ActionNotice({ notice, onClose }: { notice: { text: string; tone: NoticeTone }; onClose: () => void }) {
  const toneStyles: Record<NoticeTone, string> = {
    info: "border-blue-200 bg-white text-blue-950",
    success: "border-emerald-200 bg-white text-emerald-950",
    warning: "border-amber-200 bg-white text-amber-950",
    danger: "border-red-200 bg-white text-red-950",
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[calc(100%-2rem)] max-w-sm">
      <div className={`flex items-start justify-between gap-3 rounded border px-4 py-3 shadow-panel ${toneStyles[notice.tone]}`}>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Check size={16} className="shrink-0" />
          <span>{notice.text}</span>
        </div>
        <button className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={onClose} title="Dismiss notification">
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

function getActionCopy(
  action: ControlAction,
  botTarget: boolean | null,
  fastLoading: boolean,
  slowLoading: boolean,
  loading: boolean,
): { title: string; detail: string; tone: NoticeTone } | null {
  if (action === "bot") {
    return {
      title: botTarget ? "Starting paper bot" : "Pausing paper bot",
      detail: botTarget ? "Saving bot state, then refreshing positions and strategy data." : "Saving pause state and refreshing account data.",
      tone: botTarget ? "success" : "warning",
    };
  }

  if (action === "refresh") {
    return {
      title: "Refreshing dashboard",
      detail: "Fast account data and slower AI/scanner data are updating now.",
      tone: "info",
    };
  }

  if (action === "reset") {
    return {
      title: "Resetting paper portfolio",
      detail: "Clearing paper trades, pausing the bot, and restoring $100,000.",
      tone: "warning",
    };
  }

  if (action === "kill") {
    return {
      title: "Activating kill switch",
      detail: "New paper trade activity is being halted.",
      tone: "danger",
    };
  }

  if (action === "unhalt") {
    return {
      title: "Clearing kill switch",
      detail: "Paper activity will be available again after risk checks.",
      tone: "info",
    };
  }

  if (action === "settings") {
    return {
      title: "Saving settings",
      detail: "Speed and risk settings are being stored.",
      tone: "info",
    };
  }

  if (fastLoading || slowLoading) {
    return {
      title: fastLoading && slowLoading ? "Updating dashboard data" : fastLoading ? "Updating account data" : "Updating strategy data",
      detail: "Network refresh is rate-limited; the UI tick stays local.",
      tone: "info",
    };
  }

  if (loading) {
    return {
      title: "Loading dashboard",
      detail: "Preparing account, positions, and paper trade history.",
      tone: "info",
    };
  }

  return null;
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

type MoveType = "SUGGESTED" | "OPEN" | "CLOSED" | "REJECTED" | "ANALYSIS" | "NEWS" | "VOLATILITY" | "SCALP" | "MOCK";

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
    NEWS: "bg-blue-100 text-blue-800",
    VOLATILITY: "bg-purple-100 text-purple-800",
    SCALP: "bg-emerald-100 text-emerald-800",
    MOCK: "bg-slate-100 text-slate-700",
  };

  return (
    <span className={`inline-flex w-fit items-center gap-1 rounded px-2 py-1 text-xs font-bold ${styles[type]}`}>
      <ListChecks size={13} /> {type}
    </span>
  );
}

function ButtonSpinner() {
  return <Loader2 size={16} className="animate-spin" aria-hidden="true" />;
}

function secondsToSpeedLevel(seconds: number): number {
  return clamp(Math.round(seconds), 1, 60);
}

function speedLevelToSeconds(speedLevel: number): number {
  return clamp(Math.round(speedLevel), 1, 60);
}

function calculateSpeedMultiplier(refreshIntervalSeconds: number): number {
  return Math.round((1 + ((60 - refreshIntervalSeconds) / 59) * 4) * 10) / 10;
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
