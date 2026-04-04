# WhatChan Article Generator — Claude Context File

This file is read automatically at the start of every Claude Code session in this directory.
Do not delete it. Update it when significant changes are made.
**Last updated: April 2026**

---

## What This Project Is

A multi-sport AI article generator for the WhatChan sports network (whatchan.co.uk).
Written and owned by **Adrian Dane**.

The tool generates fully formatted, WordPress-ready HTML articles from:
- Live RSS news feeds (click any headline → Generate)
- A pasted URL (fetches and rewrites any article)
- Evergreen topics and match-specific templates (Match Preview, Match Review, Fixtures)

Supported sports: Football, Darts, Boxing, Snooker, Formula 1, Rugby, Other.

**White Label mode** is also supported — produce unbranded articles for other domains/clients, with a custom author name (or fully anonymous), no banners, and domain-specific schema.

---

## Architecture

```
Browser (GitHub Pages)
  → Cloudflare Worker (CORS proxy + secret holder)
    → OpenRouter API (AI models)
    → Perplexity Sonar Pro (live web research)
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
│   └── index.html             ← entire frontend (single file, ~4000+ lines)
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
| `FREE_MODEL` | `google/gemini-2.5-flash` | Analysis, QC, SEO, hallucination scan |
| `RESEARCH_MODEL` | `perplexity/sonar-pro` | Pre-research — live web verification |
| `ACTIVE_MODEL` | defaults to `MODELS[0].id` | User-selected writing model (Gemini 2.5 Flash) |
| `AUTHOR.name` | `Adrian Dane` | Used for WhatChan articles; overridden by White Label |
| `CURRENT_WL` | `null` or `{domain, author, noBanners}` | Set at start of each generation run; null = WhatChan mode |
| `STORAGE_KEY` | `wc_articles_v1` | localStorage key for persisted articles |

---

## Generation Pipeline (6 steps)

Every article goes through this pipeline. **Accuracy is the top priority** — accuracy over speed, accuracy over completeness.

1. **Verify** — `RESEARCH_MODEL` (Perplexity Sonar Pro) searches the live web before writing begins. Verifies: current manager, player club/status, recent results, current standings. Output stored as `VERIFIED CURRENT FACTS`. Fails gracefully if Perplexity unavailable.

2. **Analyse** — `FREE_MODEL` extracts key facts from source article. Web-verified facts are marked `[VERIFIED]` and given priority over source text if they conflict.

3. **Write** — Selected model writes the full HTML article using source facts + web-verified facts as ground truth. Time-sensitive facts (manager, player status, results) may ONLY be stated if present in provided context — never from training knowledge.

4. **Hallucination scan** — `FREE_MODEL` compares draft against source + verified facts. Flags and auto-removes: `current_manager`, `current_club`, `current_status`, `fake_quote`, `truncated_quote`, `invented_stat`, `invented_name`, `placeholder`. `stripHallucinations()` removes flagged sentences.

5. **QC + SEO** — `FREE_MODEL` runs a **source-traceability check** (not factual accuracy — model cannot know current facts). Checks that every time-sensitive claim is traceable to the provided context. If FAIL: `rewriteWithFixes()` corrects issues, then a **second QC pass** runs on the rewrite. SEO fields generated separately (sequential, not parallel).

6. **E-E-A-T polish** — Selected model enhances Experience, Expertise, Authoritativeness, Trustworthiness.

**Output badges on every article:**
- Green **✓ Web-Verified** — all steps passed
- Red **⚠ REVIEW BEFORE PUBLISHING** — hallucinations found/fixed, or QC failed even after rewrite
- Blue **White Label** — article was generated in white label mode

Output: WordPress-ready HTML block with schema.org JSON-LD, SEO comment block, banners (WhatChan only — suppressed for white label), tags.

---

## Extra Context (trusted facts for the writer)

Each generation panel has two ways to add trusted context — treated as ground truth:
1. **File upload**: PDF (text-based only), DOCX, TXT
2. **URL field**: paste any URL (Sky Sports, Wikipedia, stats page) — worker fetches it

File and URL context are merged with `\n\n---\n\n` separator and passed as `TRUSTED ADDITIONAL CONTEXT` throughout the pipeline including the hallucination scan.

**PDF caveat**: Scanned/image PDFs extract 0 chars. The UI shows a clear red error and suggests the URL context field or saving as .txt instead.

---

## SEO Fields (generated at step 5)

`genSeoFields(spec, articleBody)` receives the article draft body so keyphrases are grounded in actual content. Returns:

| Field | Detail |
|-------|--------|
| `h1` | Keyword-rich headline, under 80 chars |
| `titleOptions` | 5 SEO title options, 50-65 chars each, with `\| WhatChan` suffix |
| `metaOptions` | 2 meta description options, 120-160 chars each |
| `urlSlug` | Keyword-first, lowercase, hyphenated |
| `tags` | Up to 10 tags (named entities + topic descriptors) |
| `keyphrases` | 3 focus keyphrases, must appear verbatim in article |
| `keyphraseMatches` | `[{phrase, found: bool}]` — verified against final article at render time |
| `allKeywords` | 10-15 individual keywords |

The **SEO panel** (click SEO button on any article card) shows all options with individual copy buttons and ✓/✗ exact-match indicators for each keyphrase. Keyphrases are verified against `g.wp` (the final article HTML) at render time.

---

## Article Persistence (localStorage)

Articles are saved to `localStorage` key `wc_articles_v1` immediately after generation. On page load, articles older than 7 days are pruned automatically. Manual delete also updates storage.

- `saveArticles()` — serialises `S.generated` to localStorage; fails silently if full
- `loadArticles()` — loads and prunes (7-day cutoff); called first in `init()`
- Each article stores `savedAt: Date.now()` and `wlOptions: CURRENT_WL`
- Cards show "saved today / saved yesterday / saved Nd ago"
- Articles persist across refreshes and browser restarts, per-browser per-domain

---

## White Label Mode

Toggled via the **White Label** checkbox in the bar below the model/length controls. Sets `CURRENT_WL` at the start of each pipeline run.

```javascript
CURRENT_WL = { domain: 'example.com', author: 'Jane Smith', noBanners: true }
// OR for anonymous:
CURRENT_WL = { domain: 'example.com', author: '', noBanners: true }
```

Effects when active:
- **`getSystemPrompt()`** — uses white label author name instead of Adrian Dane; anonymous = no editors note, no byline, no WhatChan mentions instructed
- **`buildWpBlock()`** — `siteUrl` uses `https://${wl.domain}`; schema author omitted if anonymous; both banners suppressed
- **Schema publisher** — uses domain name instead of WhatChan
- **Article card** — shows blue **White Label** badge
- **`wlOptions`** stored on article object and persisted in localStorage so the badge survives reload

---

## DOCX Export

Available on every article card (WhatChan and white label). Uses `html-docx-js` CDN.

**`buildCleanHtml(wp)`** strips from the WordPress block:
- SEO comment block, JSON-LD script tags, style blocks, HTML comments
- Banner divs, tag strip, stats strip
- Converts pullquotes → `<blockquote>`, editors-note → `<em>` paragraph
- Removes `wc-post` wrapper and class/style attributes

**`downloadDocx(idx)`** — wraps the clean HTML in a full document with basic Word-compatible CSS, calls `htmlDocx.asBlob()`, triggers download named after the URL slug.

CDN: `https://unpkg.com/html-docx-js@0.3.1/dist/html-docx.js` (exposes `window.htmlDocx`)

---

## Cloudflare Worker Secrets

Two secrets stored in Cloudflare (set with `npx wrangler secret put <NAME>`):

| Secret name | Value | Purpose |
|-------------|-------|---------|
| `OPENROUTER_API_KEY` | (OpenRouter key) | Authenticates API calls to OpenRouter |
| `WC_SECRET` | `wc-9f2k4p8m` | Token frontend must send — blocks unauthorised use |

**To redeploy the worker after code changes:**
```bash
cd worker
npx wrangler deploy
```

**Important:** `Access-Control-Allow-Headers` in the worker must include `Content-Type, X-WC-Token` — otherwise browsers reject all requests in the CORS preflight.

---

## GitHub Pages Deployment

The site deploys automatically from the `main` branch, `/docs` folder.
After any `git push`, GitHub Pages rebuilds in ~2 minutes.

```bash
git add docs/index.html
git commit -m "Description of change"
git push
```

**Cache warning:** Always test in incognito (Ctrl+Shift+N) or hard-refresh (Ctrl+Shift+R) after pushing.

---

## Security

- Frontend HTML is in a **public** GitHub repo (required for free GitHub Pages)
- `WC_TOKEN` is visible in source — acceptable because the OpenRouter spend cap limits damage
- `OPENROUTER_API_KEY` is stored only as a Cloudflare Worker secret — never in the HTML
- **OpenRouter spend cap** must be set: https://openrouter.ai/settings/limits (£10/month recommended)
- CORS `ALLOWED_ORIGINS` blocks other websites embedding the tool
- `WC_SECRET` on the worker blocks direct API abuse (curl, Postman etc.)
- `Access-Control-Allow-Headers` must list `X-WC-Token` or all browser requests fail at preflight

---

## AI Models

### Writing model (user selects from dropdown)
Default: `google/gemini-2.5-flash`

| Provider | Models |
|----------|--------|
| Google | Gemini 2.5 Flash (default), Gemini 2.5 Pro |
| OpenAI | GPT-4.1 Mini, GPT-4.1, GPT-4o, o3-mini |
| Anthropic | Claude Haiku 4.5, Claude Sonnet 4, Claude Opus 4 |
| Mistral | Mistral Small 3.1, Mistral Large |
| xAI | Grok 3 Mini, Grok 3 |
| Meta | Llama 4 Scout, Llama 4 Maverick |
| DeepSeek | DeepSeek V3, DeepSeek R1 |
| Perplexity | Sonar, Sonar Pro (have live web access) |

### Hardcoded models (not user-selectable)
- `FREE_MODEL = google/gemini-2.5-flash` — analysis, QC, SEO, hallucination scan
- `RESEARCH_MODEL = perplexity/sonar-pro` — pre-research web verification step

**Free models removed** — `:free` suffix models have strict shared rate limits causing persistent 429 errors.

---

## Quality Controls

### Core principle
AI training data is out of date. The pipeline NEVER trusts the model's own knowledge for time-sensitive facts (current manager, player club, recent results). All such facts must come from the provided source, verified facts, or trusted context.

### System prompt rules (`getSystemPrompt()`)
- British English throughout
- Pure HTML output — no markdown (`**` = broken, must use `<strong>`)
- Time-sensitive facts (manager, player status, results) ONLY if in provided context
- FAQ answers ONLY from provided context — never from training knowledge
- Author: Adrian Dane (WhatChan) or white label author or no byline — never invented names
- No clichés, no padding, no placeholder text
- Never reproduce truncated quotes (quotes ending with `...`) — omit or paraphrase

### Pre-research (`preResearch()`, uses `RESEARCH_MODEL`)
Perplexity Sonar Pro searches the web before writing. Creates `VERIFIED CURRENT FACTS` document used throughout the pipeline. Fails gracefully.

### Hallucination scan (`hallucinationScan()`)
Compares draft against source + verified facts. Critical categories: `current_manager`, `current_club`, `current_status`, `fake_quote`, **`truncated_quote`**, `invented_stat`, `invented_name`, `placeholder`. `stripHallucinations()` removes flagged sentences.

### QC (`getQcSystem()`)
**Source-traceability check** — asks "is this claim in the source?" not "is this fact correct?". If FAIL: mandatory `rewriteWithFixes()` + second QC pass. Articles that fail QC (even after rewrite) get red "REVIEW BEFORE PUBLISHING" badge.

### Markdown cleanup (`cleanMarkdown()`)
Applied to all output. Converts stray markdown to HTML. Strips `[insert...]`, `[TBC]`, `[unknown...]`. Also strips truncated quoted text (regex for `"text..."` in straight and curly quotes).

---

## Banner Placement

- **Sport TV banner**: `insertMidBanner()` finds nearest `<h2>` to 50% of article, inserts banner there
- **Blog banner**: always at the bottom before tags
- Both in `buildWpBlock()` — **suppressed entirely for white label articles**

---

## RSS Feeds (worker/src/index.js)

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
| Free models (`:free`) rate-limit constantly | Removed from dropdown; paid models only |
| `google/gemini-2.0-flash-exp` deprecated | Replaced with `google/gemini-2.5-flash` |
| `getTokenLimit()` infinite recursion | `replace_all` overwrote function body — fixed manually |
| OpenRouter secret saved with wrong name | Key saved as secret NAME — deleted, recreated as `OPENROUTER_API_KEY` |
| GitHub Pages cache serving stale code | Always test in incognito after pushing |
| Pipeline parallel API calls causing 429 | QC + SEO sequential; 2s delay between all steps |
| AI inventing analyst names ("Harry Sekulich") | Author rules in prompt + hallucination scan |
| Raw `**markdown**` in HTML output | `cleanMarkdown()` + explicit prompt rule |
| AI using stale training knowledge (wrong manager, wrong club) | `RESEARCH_MODEL` pre-research + source-only rules + traceability QC |
| Adding `X-WC-Token` header broke all requests | Browser preflight rejects custom headers unless listed in `Access-Control-Allow-Headers` — fixed in worker |
| Scanned/image PDFs showing 0 chars silently | Now shows red error + Activity Log message suggesting URL context or .txt |
| QC rewrite had no second pass | Second mandatory QC pass added after `rewriteWithFixes()` |
| Truncated RSS quotes reaching published article | 3-layer fix: system prompt rule, `truncated_quote` hallucination category, `cleanMarkdown()` regex |
| Articles lost on page refresh | `localStorage` persistence with 7-day auto-expiry |

---

## Editorial Standards

Full brief at: `C:\Users\Dj4be\Documents\Blog articles claude\PROJECT-BRIEF.md`

Key rules:
- British English throughout
- WhatChan articles authored by **Adrian Dane** — white label articles use client author or anonymous
- No clichés, no padding, no repetition
- Facts only from source/verified context — never invented
- No placeholder text in output
- No em dashes or en dashes in article prose
- Time-sensitive facts (manager, player status) only from source — never from training
- Never reproduce truncated quotes (RSS feeds cut descriptions at 200 chars)
