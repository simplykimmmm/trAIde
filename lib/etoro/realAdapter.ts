import { isKillSwitchActive } from "@/lib/paper/database";
import type { IEToroAdapter } from "./adapter";
import { EToroAdapterError, type AccountInfo, type MarketQuote, type OrderRequest, type OrderResult, type Position } from "./types";

const ETORO_BASE_URL = "https://public-api.etoro.com/api/v1";

type InstrumentSearchItem = {
  instrumentId?: number;
  instrumentID?: number;
  id?: number;
  internalSymbolFull?: string;
  symbol?: string;
  displayName?: string;
};

type RatesResponse = {
  rates?: Array<{
    instrumentID?: number;
    instrumentId?: number;
    ask?: number;
    bid?: number;
    lastExecution?: number;
    date?: string;
  }>;
};

export class RealEToroAdapter implements IEToroAdapter {
  private readonly apiKey: string;
  private readonly userKey: string;
  private readonly instrumentCache = new Map<string, number>();

  constructor() {
    this.apiKey = process.env.ETORO_PUBLIC_KEY ?? process.env.ETORO_API_KEY ?? "";
    this.userKey = process.env.ETORO_USER_KEY ?? "";

    if (!this.apiKey || !this.userKey) {
      throw new EToroAdapterError("CONFIGURATION_ERROR", "ETORO_PUBLIC_KEY and ETORO_USER_KEY must both be configured server-side.");
    }
  }

  async getAccountInfo(): Promise<AccountInfo> {
    try {
      // TODO: Extend this to the official demo/real portfolio endpoint after the user chooses Demo or Real read scope.
      throw new EToroAdapterError("UNIMPLEMENTED", "Real eToro account retrieval is intentionally disabled in this paper-first prototype.");
    } catch (error) {
      this.rethrow("Unable to fetch eToro account information.", error);
    }
  }

  async getPositions(): Promise<Position[]> {
    try {
      // TODO: Extend this to the official demo/real portfolio endpoint after the user chooses Demo or Real read scope.
      throw new EToroAdapterError("UNIMPLEMENTED", "Real eToro positions retrieval is intentionally disabled in this paper-first prototype.");
    } catch (error) {
      this.rethrow("Unable to fetch eToro positions.", error);
    }
  }

  async getQuote(symbol: string): Promise<MarketQuote> {
    try {
      const normalized = symbol.trim().toUpperCase();
      const instrumentId = await this.getInstrumentId(normalized);
      const params = new URLSearchParams({ instrumentIds: String(instrumentId) });
      const data = await this.requestJson<RatesResponse>(`/market-data/instruments/rates?${params.toString()}`);
      const rate = data.rates?.find((item) => (item.instrumentID ?? item.instrumentId) === instrumentId) ?? data.rates?.[0];

      if (!rate || typeof rate.bid !== "number" || typeof rate.ask !== "number") {
        throw new EToroAdapterError("UPSTREAM_ERROR", `eToro did not return a usable rate for ${normalized}.`);
      }

      const last = typeof rate.lastExecution === "number" ? rate.lastExecution : (rate.bid + rate.ask) / 2;

      return {
        symbol: normalized,
        bid: rate.bid,
        ask: rate.ask,
        last,
        timestamp: rate.date ?? new Date().toISOString(),
        supported: true,
      };
    } catch (error) {
      this.rethrow("Unable to fetch eToro market quote.", error);
    }
  }

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    try {
      if (process.env.LIVE_TRADING !== "true") {
        throw new EToroAdapterError("LIVE_TRADING_DISABLED", "Live order placement is disabled by environment configuration.");
      }

      if (isKillSwitchActive()) {
        throw new EToroAdapterError("KILL_SWITCH_ACTIVE", "Kill switch is active. Live order placement is halted.");
      }

      void order;
      // TODO: Replace with the official eToro Demo or Real trading endpoint only after adding explicit account-scope selection and manual approval UX.
      throw new EToroAdapterError("UNIMPLEMENTED", "Real eToro order placement is not implemented. Manual approval still cannot bypass this stub.");
    } catch (error) {
      this.rethrow("Unable to place eToro order.", error);
    }
  }

  private async getInstrumentId(symbol: string): Promise<number> {
    const cached = this.instrumentCache.get(symbol);
    if (cached) {
      return cached;
    }

    const params = new URLSearchParams({ internalSymbolFull: symbol });
    const response = await this.requestJson<InstrumentSearchItem[] | { items?: InstrumentSearchItem[] }>(`/market-data/search?${params.toString()}`);
    const items = Array.isArray(response) ? response : response.items ?? [];
    const exact = items.find((item) => (item.internalSymbolFull ?? item.symbol ?? "").toUpperCase() === symbol) ?? items[0];
    const instrumentId = exact?.instrumentId ?? exact?.instrumentID ?? exact?.id;

    if (!instrumentId) {
      throw new EToroAdapterError("UNSUPPORTED_SYMBOL", `eToro did not return an instrument ID for ${symbol}.`);
    }

    this.instrumentCache.set(symbol, instrumentId);
    return instrumentId;
  }

  private async requestJson<T>(path: string): Promise<T> {
    const response = await fetch(`${ETORO_BASE_URL}${path}`, {
      method: "GET",
      headers: {
        "x-api-key": this.apiKey,
        "x-user-key": this.userKey,
        "x-request-id": crypto.randomUUID(),
      },
      cache: "no-store",
    });

    if (response.status === 429) {
      throw new EToroAdapterError("UPSTREAM_ERROR", "eToro rate limit reached. Try again later.");
    }

    if (!response.ok) {
      throw new EToroAdapterError("UPSTREAM_ERROR", `eToro API returned HTTP ${response.status}.`);
    }

    return (await response.json()) as T;
  }

  private rethrow(context: string, error: unknown): never {
    if (error instanceof EToroAdapterError) {
      throw error;
    }

    throw new EToroAdapterError("UPSTREAM_ERROR", context);
  }
}
