# Website Audit & Performance Analyzer

Evidence-first website auditor. Enter a public URL; the server runs Google PageSpeed Insights (mobile + desktop), an independent crawler and verified checks, then (optionally) an LLM that groups failures into root-cause findings using only the verified evidence. The UI shows Google's Lighthouse scores; it does not compute its own health score.

## What it does

- **Root-cause findings:** the LLM clusters failing audits into up to 5 findings, each with root cause, evidence audit IDs, fix, where to fix, effort, business risk and risk note. "Evidence strength" and "Affected" are computed in code, not by the model.
- **Evidence only:** the LLM receives condensed, code-extracted evidence (failing audits, offending items, third-party hosts, CrUX field data, optional headless-render facts) plus a fixed stack context.
- **Validation:** findings citing an audit ID that is not in the input are rejected. Numbers, hostnames and class names in the output that do not appear in the evidence are flagged in the UI ("verify before using"), and the model gets one retry with the unsupported values listed.
- **Grounded follow-up chat:** ask questions about the current report; answers use only that report and cite finding IDs.
- **Accessibility:** automated tools catch only a minority of accessibility problems; a high score does not mean the page is accessible. The model is told not to invent labels or alt text.
- SEO is not reported.

## Architecture

Browser → `POST /api/audit` → PageSpeed API (mobile + desktop) ‖ crawler ‖ optional headless render → findings → optional LLM → report.

Key folders: `lib/pagespeed`, `lib/crawler`, `lib/audits/checks.ts` (add checks here), `lib/scoring`, `lib/ai/provider.ts` (LLM abstraction), `lib/recommendations/engine.ts` (prompt, stack context, validation, chat), `lib/security/url.ts` (SSRF guard), `lib/cache`.

Stack context lives in `STACK` in `lib/recommendations/engine.ts`. Move an item from `unknown` to `confirmed` only after the team confirms it. Unknown items are never asserted by the model, so "Where to fix" shows "Not determinable from provided context".

## Setup (Node.js 18.18+; 20 LTS recommended)

```
npm install
copy .env.example .env.local        # Windows
cp .env.example .env.local          # macOS/Linux
```

Edit `.env.local`:

- `PAGESPEED_API_KEY=` **required**. Server-only; never prefix with NEXT_PUBLIC_.
- `PSI_RUNS=1` recommended. Repeated PageSpeed API calls for the same URL return the identical result, so more runs add cost, not information.
- `AI_TEMPERATURE=0.1` (clamped to 0–1). Low temperature for accuracy.
- AI is optional. Set `AI_PROVIDER` to `anthropic`, `openai`, `gemini` or `ollama`, plus that provider's key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `OLLAMA_BASE_URL`). `AI_MODEL` is optional. Without a provider the app shows verified findings only.
  - Gemini: `AI_PROVIDER=gemini`, `GEMINI_API_KEY=...`, `AI_MODEL=gemini-2.5-flash`.
  - Groq: `AI_PROVIDER=openai`, `OPENAI_BASE_URL=https://api.groq.com/openai/v1`, `OPENAI_API_KEY=<groq key>`, `AI_MODEL=<a Groq model id>`.
  - Ollama is fully local.
- `ENABLE_PLAYWRIGHT=true` (optional) enables the headless-browser pass. Requires `npx playwright install chromium`. Not available on Vercel; leave it unset there.

## Run

```
npm run dev          # http://localhost:3000
npm run build && npm start
npm run typecheck
```

Test with `https://www.deccanherald.com/`. An audit takes about 30–100 s (mobile PageSpeed can be slow). There are no automated tests yet; `typecheck` and `build` are the checks.

## Deploy (Vercel)

1. Import the repo and set the environment variables above (Production).
2. Do not set `ENABLE_PLAYWRIGHT`.
3. The audit route sets `maxDuration = 300` (the Hobby plan maximum). Redeploy after changing env vars.
4. Smoke test: run an audit, then ask a question in the chat.
5. The app uses your PageSpeed and LLM keys, so restrict the Google key to the PageSpeed API, set quota limits, and consider Vercel Deployment Protection if the URL is not meant to be public.

## API

`POST /api/audit` body `{ "url": "https://example.com", "checkText": "optional" }` → `{ url, finalUrl, timestamp, pagespeed, crawler, render, categories, issues, recommendations, summary }`.

Follow-up chat: `{ "url", "checkText", "question", "report" }` → `{ answer, findingIds, unverified }`. The browser sends a slim copy of the report, so answers are only as trustworthy as that report.

## Security

http/https only; blocks localhost/private/link-local/metadata IPs (DNS-resolved, re-checked on every redirect); 15 s timeout, 3 MB body cap, 8 redirects max; 5 audits/min/IP (in-memory, per instance); keys never sent to the browser or logged. Known gap: DNS rebinding between check and connect is not fully closed; for public hosting add network-level egress filtering.

## Limitations / TODO

- No cross-page or cross-site comparison yet (needs a list of template URLs and a batch run; each audit takes about 100 s).
- A multi-run median needs local Lighthouse runs; the PageSpeed API repeats the same result.
- Stack-specific fix locations depend on confirmed facts in `STACK` (GTM, ads, consent, CDN, Kannada webfont loading, template head).
- Claim checks cover numbers with units, hostnames and class-like tokens. Logic claims (for example "scripts are synchronous") are not checked and need human review.
- Effort and business risk are model estimates, not measurements.
- Cache and rate limiter are in-memory (reset on restart, per instance).
- PageSpeed quota: the free key is limited per day/minute; each audit uses 2 calls. Results are cached 30 min.
- Troubleshooting: "quota exceeded" → wait; "PAGESPEED_API_KEY not configured" → check env and restart/redeploy; PageSpeed 400 → URL not publicly reachable; "PageSpeed request timed out" → retry.