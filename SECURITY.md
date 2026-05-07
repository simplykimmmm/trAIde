# Security

This prototype is designed to fail closed and to keep secrets server-side.

- Store API keys only in `.env.local`.
- Never place eToro, Gemini, account identifiers, or PII in client components.
- Never commit `.env.local`, SQLite data files, logs containing secrets, or account exports.
- Use only official eToro APIs after verifying current documentation and terms.
- Do not use browser automation, scraping, private endpoints, or controls that bypass account security.
- Live trading must remain opt-in with `LIVE_TRADING=true` and manual approval per trade.

Report security issues privately to the project owner. Do not open public issues with secrets or exploitable details.
