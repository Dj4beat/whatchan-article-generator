# WhatChan Article Generator — Claude Context File

This file is read automatically at the start of every Claude Code session in this directory.
Do not delete it. Update it when significant changes are made.

---

## What This Project Is

A multi-sport AI article generator for the WhatChan sports network (whatchan.co.uk).
Written and owned by **Adrian Dane**. All articles are attributed to Adrian Dane.

The tool generates fully formatted, WordPress-ready HTML articles from:
- Live RSS news feeds (click any headline → Generate)
- A pasted URL (fetches and rewrites any article)
- Evergreen topics and match-specific templates (Match Preview, Match Review, Fixtures)

Supported sports: Football, Darts, Boxing, Snooker, Formula 1, Rugby, Other.

---

## Architecture

```
Browser (GitHub Pages)
  → Cloudflare Worker (CORS proxy + secret holder)
    → OpenRouter API (AI models)
    → RSS feeds (BBC, Sky, Guardian, PDC, Autosport etc.)
    → Article URL extraction
```

### Live URLs
| Resource | URL |
|----------|-----|
| **Frontend (live site)** | https://dj4beat.github.io/whatchan-article-generator/ |
| **GitHub repo** | https://github.com/Dj4beat/whatchan-article-generator |
| **Cloudflare Worker** | https://whatchan-api-proxy.dj4beat.workers.dev |
| **OpenRouter account** | https://openrouter.ai |

---

## File Structure

```
Blog Generator/
├── CLAUDE.md                  ← this file (Claude context)
├── GUIDE.html                 ← user manual (open in browser)
├── README.md                  ← setup instructions
├── docs/
│   └── index.html             ← entire frontend (single file, ~3000 lines)
└── worker/
    ├── src/index.js           ← Cloudflare Worker (proxy + RSS parser)
    ├── wrangler.toml          ← worker config (name: whatchan-api-proxy)
    └── package.json
```

---

## Key Variables in docs/index.html

| Variable | Value | Purpose |
|----------|-------|---------|
| `PROXY_URL` | `https://whatchan-api-proxy.dj4beat.workers.dev` | Worker URL |
| `WC_TOKEN` | `wc-9f2k4p8m` | Must match `WC_SECRET` worker secret |
| `FREE_MODEL` | `google/gemini-2.5-flash` | Used for analysis, QC, SEO, hallucination scan |
| `ACTIVE_MODEL` | defaults to `MODELS[0].id` | User-selected writing model |
| `AUTHOR.name` | `Adrian Dane` | Hardcoded into schema — AI cannot change this |

---

## Generation Pipeline (5 steps)

Every article goes through this pipeline:

1. **Fetch** — Worker fetches full article text from the source URL
2. **Analyse** — `FREE_MODEL` extracts key facts, quotes, names, angle from source
3. **Write** — Selected model writes the full HTML article
4. **Hallucination scan** — `FREE_MODEL` compares draft against source, auto-removes invented names/quotes/stats/placeholders
5. **QC + SEO** — `FREE_MODEL` fact-checks the draft; separate call generates SEO fields (sequential, not parallel)
6. **E-E-A-T polish** — Selected model enhances Experience, Expertise, Authoritativeness, Trustworthiness

Output: WordPress-ready HTML block with schema.org JSON-LD, SEO comment block, tags, banners.

---

## Cloudflare Worker Secrets

Two secrets stored in Cloudflare (set with `npx wrangler secret put <NAME>`):

| Secret name | Value | Purpose |
|-------------|-------|---------|
| `OPENROUTER_API_KEY` | (OpenRouter key) | Authenticates API calls to OpenRouter |
| `WC_SECRET` | `wc-9f2k4p8m` | Token that the frontend must send — blocks unauthorised use |

**To redeploy the worker after code changes:**
```bash
cd worker
npx wrangler deploy
```

**To update a secret:**
```bash
cd worker
npx wrangler secret put WC_SECRET
```

---

## GitHub Pages Deployment

The site deploys automatically from the `main` branch, `/docs` folder.
After any `git push`, GitHub Pages rebuilds in ~2 minutes.

To push changes:
```bash
git add docs/index.html
git commit -m "Description of change"
git push
```

**Cache warning:** After pushing, always test in an incognito window (Ctrl+Shift+N) or hard-refresh (Ctrl+Shift+R). GitHub Pages caches aggressively.

---

## Security

- The frontend HTML is in a **public** GitHub repo (required for free GitHub Pages)
- The `WC_TOKEN` in the HTML is visible in source — this is acceptable because the token alone is not enough to cause damage, and the OpenRouter spend cap limits worst-case exposure
- The `OPENROUTER_API_KEY` is stored only as a Cloudflare Worker secret — never in the HTML
- **OpenRouter spend cap** should be set at https://openrouter.ai/settings/limits (recommended: £10/month)
- CORS `ALLOWED_ORIGINS` blocks other websites from embedding the tool, but does not block direct requests (that's what `WC_SECRET` is for)

---

## AI Models

### Writing model (user selects from dropdown)
Default: `google/gemini-2.5-flash`

All models are in the `MODELS` array in `docs/index.html` (~line 630). The array includes:
- Google: Gemini 2.5 Flash, Gemini 2.5 Pro
- OpenAI: GPT-4.1 Mini, GPT-4.1, GPT-4o, o3-mini
- Anthropic: Claude Haiku 4.5, Claude Sonnet 4, Claude Opus 4
- Mistral: Mistral Small 3.1, Mistral Large
- xAI: Grok 3 Mini, Grok 3
- Meta: Llama 4 Scout, Llama 4 Maverick
- DeepSeek: DeepSeek V3, DeepSeek R1

### Grunt model (hardcoded, not user-selectable)
`google/gemini-2.5-flash` — used for analysis, QC, SEO, hallucination scan.
Cheap enough that running 3-4 calls per article costs fractions of a penny.

---

## Quality Controls

### Prompt-level rules (in `getSystemPrompt()`, ~line 1374)
- British English throughout
- No markdown in output — pure HTML only
- No invented names, no fabricated quotes, no placeholder text
- Author is always Adrian Dane — AI told not to invent analyst names
- No clichés (do-or-die, firing on all cylinders, etc.)

### Hallucination scan (in `hallucinationScan()`)
Runs after writing, before QC. Compares draft against source.
Flags: invented person names, fabricated quotes, invented stats, placeholder text.
`stripHallucinations()` auto-removes flagged sentences.

### QC system (`getQcSystem()`)
Checks: wrong names, wrong people, wrong stats, outdated context, fabricated quotes, wrong dates, quality.
If verdict is FAIL: `rewriteWithFixes()` corrects the draft using the selected model.

### Markdown cleanup (`cleanMarkdown()`)
Safety net applied to all article output.
Converts: `**text**` → `<strong>`, `*text*` → `<em>`, `## ` → `<h2>`.
Strips: `[insert ...]`, `[TBC]`, `[unknown ...]`.

---

## Banner Placement

- **Sport TV banner**: inserted at the nearest `<h2>` to the 50% mark of the article body
- **Blog banner**: always at the bottom, before the tags
- Logic is in `insertMidBanner()` inside `buildWpBlock()`

---

## RSS Feeds

Configured in `worker/src/index.js` (`RSS_FEEDS` object).

| Sport | Sources |
|-------|---------|
| Football | BBC Sport, Sky Sports, The Athletic, Guardian |
| Darts | BBC Sport, Sky Sports, PDC |
| Boxing | BBC Sport, Sky Sports, Guardian |
| Snooker | BBC Sport, Eurosport |
| F1 | BBC Sport, Sky Sports, Guardian, Autosport |
| Rugby | BBC Sport, Sky Sports, Guardian |

---

## Known Issues & Past Fixes

| Issue | Fix applied |
|-------|-------------|
| Free models (`:free`) rate-limit at 20 req/min | Removed from dropdown; use paid models only |
| `google/gemini-2.0-flash-exp` deprecated | Replaced with `google/gemini-2.5-flash` |
| `getTokenLimit()` infinite recursion | Caused by `replace_all` overwriting its own body — fixed manually |
| OpenRouter secret saved with wrong name | Key was saved as secret NAME not `OPENROUTER_API_KEY` — deleted and recreated |
| GitHub Pages cache serving stale code | Always test in incognito after pushing |
| Pipeline making parallel API calls | QC + SEO now run sequentially; 2s delay between all steps |
| AI inventing analyst names (e.g. "Harry Sekulich") | Author rules in system prompt + hallucination scan |
| Raw `**markdown**` in HTML output | `cleanMarkdown()` safety net + explicit prompt rule |

---

## Editorial Standards (from PROJECT-BRIEF.md)

Full brief at: `C:\Users\Dj4be\Documents\Blog articles claude\PROJECT-BRIEF.md`

Key rules:
- British English throughout
- Every article authored by **Adrian Dane**
- No clichés, no padding, no repetition
- Facts only from source material — never invented
- No placeholder text left in output
- No em dashes or en dashes in article prose
