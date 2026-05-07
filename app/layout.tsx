import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "trAIde Paper Trading Bot",
  description: "Local paper-trading-first AI-assisted trading dashboard.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
