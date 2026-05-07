import { GoogleGenerativeAI } from "@google/generative-ai";

export async function callGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL ?? "gemini-flash-latest",
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  });

  return withTransientRetry(async () => {
    const result = await model.generateContent(prompt);
    return result.response.text();
  });
}

export async function waitForGeminiRateLimit(): Promise<void> {
  const delayMs = Number(process.env.GEMINI_DELAY_MS ?? 1200);
  if (Number.isFinite(delayMs) && delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

async function withTransientRetry<T>(operation: () => Promise<T>): Promise<T> {
  const delays = [1000, 2500];
  let lastError: unknown;

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const transient = message.includes("[503") || message.includes("[429") || message.toLowerCase().includes("high demand");

      if (!transient || attempt === delays.length) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }

  throw lastError;
}
