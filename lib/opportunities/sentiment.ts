import type { FinnhubNewsItem } from "@/lib/market/finnhubAdapter";

export type SentimentLabel = "EXTREME_FEAR" | "FEAR" | "NEUTRAL" | "GREED" | "EXTREME_GREED";
export type SentimentSignal = "CONTRARIAN_BUY" | "MOMENTUM_BUY" | "CAUTION" | "NEUTRAL";

export type SentimentSnapshot = {
  sentimentScore: number;
  sentimentLabel: SentimentLabel;
  sentimentSignal: SentimentSignal;
  sentimentReason: string;
  materialRisk: boolean;
};

type WeightedTerm = {
  term: string;
  weight: number;
};

const FEAR_TERMS: WeightedTerm[] = [
  { term: "panic", weight: -24 },
  { term: "capitulation", weight: -22 },
  { term: "crash", weight: -22 },
  { term: "plunge", weight: -18 },
  { term: "selloff", weight: -16 },
  { term: "slump", weight: -14 },
  { term: "rout", weight: -14 },
  { term: "fear", weight: -12 },
  { term: "recession", weight: -12 },
];

const MATERIAL_RISK_TERMS: WeightedTerm[] = [
  { term: "bankruptcy", weight: -36 },
  { term: "insolvency", weight: -34 },
  { term: "default", weight: -30 },
  { term: "fraud", weight: -30 },
  { term: "lawsuit", weight: -24 },
  { term: "probe", weight: -22 },
  { term: "investigation", weight: -20 },
  { term: "sec charges", weight: -28 },
  { term: "delisting", weight: -28 },
];

const NEGATIVE_TERMS: WeightedTerm[] = [
  { term: "downgrade", weight: -16 },
  { term: "misses estimates", weight: -16 },
  { term: "cuts guidance", weight: -16 },
  { term: "layoffs", weight: -14 },
  { term: "recall", weight: -12 },
  { term: "warning", weight: -10 },
];

const POSITIVE_TERMS: WeightedTerm[] = [
  { term: "beats estimates", weight: 18 },
  { term: "raises guidance", weight: 18 },
  { term: "upgrade", weight: 16 },
  { term: "approval", weight: 14 },
  { term: "partnership", weight: 12 },
  { term: "record revenue", weight: 12 },
  { term: "launches", weight: 10 },
  { term: "surges", weight: 10 },
  { term: "rallies", weight: 10 },
];

const GREED_TERMS: WeightedTerm[] = [
  { term: "mania", weight: 28 },
  { term: "euphoria", weight: 26 },
  { term: "frenzy", weight: 22 },
  { term: "meme stock", weight: 20 },
  { term: "short squeeze", weight: 18 },
  { term: "all-time high", weight: 16 },
  { term: "record high", weight: 16 },
];

export function scoreNewsSentiment(news: FinnhubNewsItem | undefined): SentimentSnapshot {
  const text = normalizeText(`${news?.headline ?? ""} ${news?.summary ?? ""}`);

  if (!text) {
    return {
      sentimentScore: 0,
      sentimentLabel: "NEUTRAL",
      sentimentSignal: "NEUTRAL",
      sentimentReason: "No linked news sentiment.",
      materialRisk: false,
    };
  }

  const matches = [
    ...scoreTerms(text, POSITIVE_TERMS),
    ...scoreTerms(text, GREED_TERMS),
    ...scoreTerms(text, FEAR_TERMS),
    ...scoreTerms(text, NEGATIVE_TERMS),
    ...scoreTerms(text, MATERIAL_RISK_TERMS),
  ];
  const materialRisk = matches.some((match) => MATERIAL_RISK_TERMS.some((term) => term.term === match.term));
  const crowdedGreed = matches.some((match) => GREED_TERMS.some((term) => term.term === match.term));
  const sentimentScore = clamp(matches.reduce((sum, match) => sum + match.weight, 0), -100, 100);
  const sentimentLabel = labelSentiment(sentimentScore, crowdedGreed);
  const sentimentSignal = signalSentiment(sentimentScore, materialRisk, crowdedGreed);
  const topTerms = matches
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 3)
    .map((match) => match.term);

  return {
    sentimentScore,
    sentimentLabel,
    sentimentSignal,
    sentimentReason: topTerms.length
      ? `${formatLabel(sentimentLabel)} from news terms: ${topTerms.join(", ")}.`
      : "Linked news was present, but sentiment stayed neutral.",
    materialRisk,
  };
}

function scoreTerms(text: string, terms: WeightedTerm[]): WeightedTerm[] {
  return terms.filter(({ term }) => text.includes(term));
}

function signalSentiment(score: number, materialRisk: boolean, crowdedGreed: boolean): SentimentSignal {
  if (materialRisk) {
    return "CAUTION";
  }

  if (score <= -35) {
    return "CONTRARIAN_BUY";
  }

  if (score >= 55 && crowdedGreed) {
    return "CAUTION";
  }

  if (score >= 20) {
    return "MOMENTUM_BUY";
  }

  return "NEUTRAL";
}

function labelSentiment(score: number, crowdedGreed: boolean): SentimentLabel {
  if (score <= -60) {
    return "EXTREME_FEAR";
  }

  if (score <= -20) {
    return "FEAR";
  }

  if (score >= 60 && crowdedGreed) {
    return "EXTREME_GREED";
  }

  if (score >= 20) {
    return "GREED";
  }

  return "NEUTRAL";
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function formatLabel(label: SentimentLabel): string {
  return label.toLowerCase().replace(/_/g, " ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
