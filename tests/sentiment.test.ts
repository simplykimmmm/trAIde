import { scoreNewsSentiment } from "@/lib/opportunities/sentiment";

describe("opportunity news sentiment scoring", () => {
  it("treats broad panic as a contrarian signal", () => {
    const sentiment = scoreNewsSentiment({
      headline: "Bitcoin crash sparks panic after steep selloff",
      summary: "Traders describe capitulation as crypto prices plunge.",
    });

    expect(sentiment.sentimentScore).toBeLessThanOrEqual(-35);
    expect(sentiment.sentimentSignal).toBe("CONTRARIAN_BUY");
    expect(sentiment.materialRisk).toBe(false);
  });

  it("blocks material company-risk headlines as caution instead of dip-buying", () => {
    const sentiment = scoreNewsSentiment({
      headline: "Company faces fraud probe and bankruptcy risk",
      summary: "Regulators opened an investigation after default warnings.",
    });

    expect(sentiment.sentimentSignal).toBe("CAUTION");
    expect(sentiment.materialRisk).toBe(true);
  });

  it("recognizes positive catalyst momentum", () => {
    const sentiment = scoreNewsSentiment({
      headline: "Chipmaker beats estimates after AI partnership",
      summary: "Analysts upgrade shares as the company raises guidance.",
    });

    expect(sentiment.sentimentScore).toBeGreaterThanOrEqual(20);
    expect(sentiment.sentimentSignal).toBe("MOMENTUM_BUY");
  });

  it("treats euphoric headlines as caution", () => {
    const sentiment = scoreNewsSentiment({
      headline: "Meme stock mania hits all-time high in trading frenzy",
      summary: "Retail euphoria surrounds another short squeeze.",
    });

    expect(sentiment.sentimentLabel).toBe("EXTREME_GREED");
    expect(sentiment.sentimentSignal).toBe("CAUTION");
  });
});
