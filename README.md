# Website Audit & Performance Analyzer

Evidence-first website auditor. Enter a public URL; the server runs Google PageSpeed Insights (mobile + desktop), an independent crawler, ~45 verified checks, our own scoring, and (optionally) an LLM that reasons only over the verified evidence.

## Architecture
Browser → `POST /api/audit` → PageSpeed API (mobile+desktop) ‖ crawler → findings (evidence-based, PASS/FAIL/WARNING/NOT_APPLICABLE/INCOMPLETE/ERROR) → scoring → optional LLM → report.

Key folders: `lib/pagespeed`, `lib/crawler`, `lib/audits/checks.ts` (add checks here), `lib/scoring`, `lib/ai/provider.ts` (LLM abstraction), `lib/recommendations`, `lib/security/url.ts` (SSRF guard), `lib/cache`.

## Setup (Node.js 18.18+; 20 LTS recommended)
```
npm install
copy .env.example .env.local        # Windows
cp .env.example .env.local          # macOS/Linux
```
Edit `.env.local`:
- `PAGESPEED_API_KEY=` **required** — your Google PageSpeed key. Server-only; never prefix with NEXT_PUBLIC_.
- **Free AI (no card):** get a key at https://aistudio.google.com/apikey and set `AI_PROVIDER=gemini`, `GEMINI_API_KEY=...`, `AI_MODEL=gemini-2.5-flash`. Free-tier limits are shown in your AI Studio console; free-tier prompts may be used by Google to improve products. Groq works too: `AI_PROVIDER=openai`, `OPENAI_BASE_URL=https://api.groq.com/openai/v1`, `OPENAI_API_KEY=<groq key>`, `AI_MODEL=<a Groq model id>`. Ollama is fully local/free.
- AI is optional. Set `AI_PROVIDER` to `anthropic`, `openai`, `gemini` or `ollama`, plus that provider's key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `OLLAMA_BASE_URL`). `AI_MODEL` is optional (defaults exist). Without it the app shows verified findings only.

## Run
```
npm run dev          # http://localhost:3000
npm run build && npm start
npm run typecheck
```
Test with `https://www.deccanherald.com/subscribe`. An audit takes ~30–90 s.

## API
`POST /api/audit` body `{ "url": "https://example.com" }` → `{ url, finalUrl, timestamp, pagespeed, crawler, categories, issues, recommendations, summary }`.

## Security
http/https only; blocks localhost/private/link-local/metadata IPs (DNS-resolved, re-checked on every redirect); 15 s timeout, 3 MB body cap, 8 redirects max; 5 audits/min/IP; keys never sent to the browser or logged. Known gap: DNS rebinding between check and connect is not fully closed; for public hosting add network-level egress filtering.

## Limitations / TODO
- No Playwright rendering yet: crawler sees served HTML only (client-rendered content is flagged, not analysed).
- Broken-link checking, per-image byte sizes, and page-level Accessibility checks beyond Lighthouse are not implemented.
- Custom-category scores use a simple severity-penalty formula; overall = average of available category scores.
- Cache and rate limiter are in-memory (reset on restart, per-instance). Audit history page (`/audit/[id]`) is not built.
- PageSpeed quota: the free key is limited per day/minute; each audit uses 2 calls. Results are cached 30 min.
- Troubleshooting: "quota exceeded" → wait; "PAGESPEED_API_KEY not configured" → check `.env.local` and restart; PageSpeed 400 → URL not publicly reachable.
