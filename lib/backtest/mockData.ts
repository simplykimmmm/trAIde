import type { OhlcvBar } from "./types";

export const mockOhlcvData: OhlcvBar[] = [
  { date: "2024-01-02", open: 473.5, high: 478.2, low: 472.1, close: 476.8, volume: 82_000_000 },
  { date: "2024-01-03", open: 475.1, high: 477.4, low: 471.9, close: 473.2, volume: 77_500_000 },
  { date: "2024-01-04", open: 474.2, high: 481.1, low: 473.3, close: 480.5, volume: 88_200_000 },
  { date: "2024-01-05", open: 481.2, high: 484.7, low: 479.4, close: 483.1, volume: 79_900_000 },
  { date: "2024-01-08", open: 484.5, high: 486.2, low: 480.7, close: 481.4, volume: 81_100_000 },
  { date: "2024-01-09", open: 480.8, high: 488.6, low: 479.8, close: 487.9, volume: 84_000_000 },
];
