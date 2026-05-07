import { readFileSync } from "node:fs";
import type { OhlcvBar } from "./types";

export function loadOhlcvCsv(filePath: string): OhlcvBar[] {
  const csv = readFileSync(filePath, "utf8");
  return parseOhlcvCsv(csv);
}

export function parseOhlcvCsv(csv: string): OhlcvBar[] {
  const [headerLine, ...rows] = csv.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map((header) => header.trim().toLowerCase());
  const required = ["date", "open", "high", "low", "close", "volume"];

  for (const column of required) {
    if (!headers.includes(column)) {
      throw new Error(`Missing required CSV column: ${column}`);
    }
  }

  return rows
    .filter(Boolean)
    .map((row) => {
      const values = row.split(",").map((value) => value.trim());
      const record = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
      return {
        date: record.date,
        open: toNumber(record.open, "open"),
        high: toNumber(record.high, "high"),
        low: toNumber(record.low, "low"),
        close: toNumber(record.close, "close"),
        volume: toNumber(record.volume, "volume"),
      };
    });
}

function toNumber(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric CSV value for ${label}.`);
  }

  return parsed;
}
