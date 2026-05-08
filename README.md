# trAIde Paper Trading Bot

trAIde is a local, paper-trading-first educational prototype for AI-assisted trade analysis. It does not provide financial advice, does not promise profit, and defaults to paper trading.

## File Tree

```text
/
├── app/
│   ├── page.tsx
│   ├── layout.tsx
│   ├── globals.css
│   └── api/
│       ├── account/route.ts
│       ├── positions/route.ts
│       ├── analysis/route.ts
│       ├── suggest/route.ts
│       ├── approve-trade/route.ts
│       ├── paper-trades/route.ts
│       └── kill-switch/route.ts
├── lib/
│   ├── etoro/
│   ├── ai/
│   ├── risk/
│   ├── paper/
│   └── backtest/
├── tests/
│   ├── risk.test.ts
│   └── aiSchema.test.ts
├── public/
├── .env.example
├── README.md
├── SECURITY.md
├── DISCLAIMER.md
├── jest.config.ts
├── next.config.mjs
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

## Disclaimer

This project is for education and local experimentation only. It is not financial advice, investment advice, or a recommendation to buy or sell any asset. No profit is guaranteed or implied.

Backtest disclaimer: ⚠️ Past performance does not guarantee future results. Backtesting has significant limitations including survivorship bias and look-ahead bias.

## Prerequisites

- Node.js 20 or newer is recommended.
- A Google Gemini API key is optional. Without it, the app returns validated fail-closed mock `HOLD` analyses. The default model is `gemini-flash-latest`.
- eToro credentials are not required for paper mode.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Fill `GEMINI_API_KEY` in `.env.local` if you want real Gemini analysis.

## Vercel Deployment

Vercel does not read your local `.env.local`. Add deployment variables in Vercel Project Settings -> Environment Variables, then redeploy:

```bash
FINNHUB_API_KEY=your_finnhub_key
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-flash-latest
GEMINI_DELAY_MS=1200
LIVE_TRADING=false
USE_REAL_ETORO=false
WATCHLIST=SPY,QQQ,AAPL,MSFT,GOOGL,BTC/USD,ETH/USD
ALLOW_LEVERAGE=true
PAPER_EXPOSURE_MULTIPLIER=5
MAX_DAILY_LOSS_PCT=1
MAX_ACCOUNT_RISK_PCT=1
OPPORTUNITY_SCANNER=true
OPPORTUNITY_UNIVERSE=SPY,QQQ,AAPL,MSFT,GOOGL,AMZN,AMD,COIN,META,NVDA,PLTR,SOFI,TSLA,BTC/USD,ETH/USD,SOL/USD,DOGE/USD
OPPORTUNITY_LIMIT=8
OPPORTUNITY_MAX_SCAN_SYMBOLS=18
OPPORTUNITY_MIN_SCORE=22
WEEKEND_CRYPTO_ONLY=true
```

If the deployed header says `DATA: MOCK`, `FINNHUB_API_KEY` is missing or unavailable in that Vercel environment. If it says `BOT: PAUSED`, click Start in the dashboard. SQLite storage on Vercel serverless is ephemeral, so bot state and paper trades can reset; use a hosted database before relying on deployed persistence.

## Paper Trading

Paper trading is the default. The dashboard reads local account, trade, system state, and risk data from SQLite through server-side API routes. Suggested trades must pass the risk engine before an Approve button appears. Approving in paper mode records a simulated trade in `data/paper-trading.sqlite`, applies a simple 0.1% fee approximation, and tracks stop-loss and take-profit closure on price updates.

For live or delayed quote data, set `FINNHUB_API_KEY` in `.env.local`. Without it, the app uses mock quotes.

The kill switch writes `KILL_SWITCH=true` into SQLite and blocks new trade activity. When halted, the dashboard shows an explicit Un-halt button that clears the local paper-trading halt state.

Aggressive simulation is available through `PAPER_EXPOSURE_MULTIPLIER` and `ALLOW_LEVERAGE=true`, but only for paper mode. The risk engine caps stop-loss risk to `MAX_ACCOUNT_RISK_PCT` of account equity and refuses live leveraged trades.

Paper trades use a flat `$1` transaction fee on open and another `$1` fee on close. The dashboard shows stake/notional, fees paid, realized PnL, unrealized PnL, and a paper PnL graph.

The Start button enables a paper-bot refresh loop using the dashboard speed setting. It does not auto-approve trades; manual approval is still required. The kill switch pauses the loop immediately.

## Opportunity Scanner

The server-side opportunity scanner uses Finnhub quotes, market news, and recent candles when `FINNHUB_API_KEY` is configured. It ranks broader stock and crypto candidates from `OPPORTUNITY_UNIVERSE`, looks for news-linked symbols, RSI/ATR-confirmed high volatility, regime-filtered momentum, and drop-bounce setups, then sends qualifying non-mock ideas through the same risk engine as watchlist trades.

When `WEEKEND_CRYPTO_ONLY=true`, the app switches to crypto-only scanning from Friday after the normal US equity close window through Monday premarket. During that window, stock symbols are filtered out of analysis, suggestions, and manual approvals; crypto symbols such as `BTC/USD`, `ETH/USD`, `SOL/USD`, and `DOGE/USD` remain available in paper mode.

This is still an educational paper-trading feature. It cannot guarantee profit, it can be wrong or stale, and it does not bypass manual approval, the kill switch, max position limits, stale data checks, or live-trading locks.

## eToro Public API

The app can use the official eToro Public API for read-only market quotes when both `ETORO_PUBLIC_KEY` and `ETORO_USER_KEY` are present and `USE_REAL_ETORO=true`.

The public key alone is not sufficient. eToro requests require `x-api-key`, `x-user-key`, and `x-request-id` headers. Keys stay server-side in `.env.local`.

## Live Trading

Live trading is locked behind `LIVE_TRADING=true` and manual per-trade approval. Real eToro order placement remains intentionally stubbed in v1. Do not use scraping, browser automation, unofficial endpoints, or any workaround that violates eToro terms or security controls.

To explore the integration point, see the `// TODO` comments in `lib/etoro/realAdapter.ts`.

## Tests

```bash
npm test
```

The test suite covers every risk rejection reason and the Gemini output schema.

## Known Limitations

- Real eToro order placement is not implemented.
- Market data in mock mode is generated locally and is not suitable for trading decisions.
- Paper fills are simplified and do not model real liquidity, slippage, taxes, or exchange-specific fees.
- Gemini analysis can be wrong, stale, or unavailable; failed validation rejects the output.
- Backtesting is intentionally minimal and cannot predict live results.
