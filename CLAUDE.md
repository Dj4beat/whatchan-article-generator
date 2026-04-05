# WhatChan Article Generator — Claude Context File

This file is read automatically at the start of every Claude Code session in this directory.
Do not delete it. Update it when significant changes are made.
**Last updated: 5 April 2026**

---

## Documentation Rules — MANDATORY

These rules apply to every Claude Code session working on this project:

1. **After every major change** (new feature, pipeline change, worker update, schema change), update ALL THREE documentation files:
   - `CLAUDE.md` — technical reference for Claude Code sessions
   - `GUIDE.html` — user manual for Adrian (assume the reader knows NOTHING about code, APIs, or git — explain everything in plain English with step-by-step instructions)
   - `CHANGELOG.md` — version-by-version detail with knock-on effects

2. **After any session lasting more than 30 minutes**, create a documentation checkpoint even if changes seem minor. Small changes compound and documentation drifts fast.

3. **Tag a git release** (`git tag vX.Y`) after any session that adds or changes features. Update the version table in GUIDE.html and the CHANGELOG.md entry.

4. **GUIDE.html golden rule**: write for someone who has never used a terminal, never seen a git command, and doesn't know what an API is. Every instruction must be copy-paste ready. Every concept must be explained. Better to over-explain than to assume knowledge. If in doubt, add a screenshot description, a "what this means" note, or a plain-English summary after any technical term.

5. **CHANGELOG.md golden rule**: for every change, document what ELSE needs to happen. Did you change the worker? It needs redeploying. Did you add a KV namespace? Someone setting up fresh needs to create it. Did you change the article schema? Old articles in localStorage won't have the new fields. These knock-on effects are more important than the change itself.

---

## What This Project Is

A multi-sport AI article generator for the WhatChan sports network (whatchan.co.uk).
Written and owned by **Adrian Dane**.

The tool generates fully formatted, WordPress-ready HTML articles from:
- Live RSS news feeds (click any headline → Generate)
- A pasted URL (fetches and rewrites any article)
- Evergreen topics and match-specific templates (Match Preview, Match Review, Fixtures)
- Custom Topics with expert journalist templates and optional club selection

Supported sports: Football, Darts, Boxing, Snooker, Formula 1, Rugby, Other.

**White Label mode** — produce unbranded articles for other domains/clients, with a custom author name (or fully anonymous), no banners, and domain-specific schema.

---

## Architecture

```
Browser (GitHub Pages)
  → Cloudflare Worker (CORS proxy + secret holder + KV feedback storage)
    → OpenRouter API (20+ AI models)
    → Perplexity Sonar Pro (live web research)
    → RSS feeds (BBC, Sky, Guardian, PDC, Autosport etc.)
    → Reference sites (premierinjuries.com, rotowire.com, live-footballontv.com)
    → Article URL extraction
    → Cloudflare KV (permanent feedback/learning memory)
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
│   └── index.html             ← entire frontend (single file, ~4200 lines)
└── worker/
    ├── src/index.js           ← Cloudflare Worker (proxy + RSS + feedback API)
    ├── wrangler.toml          ← worker config (KV binding: FEEDBACK)
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
| `ACTIVE_MODEL` | defaults to `MODELS[0].id` | User-selected writing model |
| `AUTHOR.name` | `Adrian Dane` | Used for WhatChan articles; overridden by White Label |
| `CURRENT_WL` | `null` or `{domain, author, noBanners}` | Set at start of each generation run |
| `STORAGE_KEY` | `wc_articles_v1` | localStorage key for persisted articles (7-day TTL) |
| `FEEDBACK_KEY` | `wc_feedback_v1` | localStorage fallback for feedback (primary is KV) |
| `S.feedbackMemory` | `[]` | In-memory cache of feedback entries, loaded from KV at init |

---

## Generation Pipeline

Every article goes through this pipeline. **Accuracy is the top priority** — accuracy over speed, accuracy over completeness.

### Standard Pipeline (News Feed / URL / Evergreen)

1. **Verify** — `RESEARCH_MODEL` (Perplexity Sonar Pro) searches the live web. Verifies managers, player status, results, standings. Output: `VERIFIED CURRENT FACTS`. Fails gracefully.
2. **Analyse** — `FREE_MODEL` extracts key facts. Web-verified facts marked `[VERIFIED]` and prioritised.
3. **Write** — Selected model writes full HTML article. Time-sensitive facts ONLY from context.
4. **Hallucination scan** — `FREE_MODEL` compares draft against source. Categories: `current_manager`, `current_club`, `current_status`, `fake_quote`, `truncated_quote`, `invented_stat`, `invented_name`, `placeholder`, `generic_filler`, `fabricated_quote`. Stripped automatically. **Findings saved to feedback memory.**
5. **QC + SEO** — Source-traceability check with auto-retry loop (see below). SEO fields generated separately.
6. **E-E-A-T polish** — Experience, Expertise, Authoritativeness, Trustworthiness enhancement.

### Match Article Pipeline (Match Preview / Match Review)

When a club is selected + category is "Match Previews" or "Match Reports":

1. **Research** — `preResearchMatch()` via Perplexity Sonar Pro finds specific fixture/result data (opponent, date, score, form, H2H, injuries, managers, TV). Demands "NOT FOUND" for missing data — never generic statements.
2. **Reference sites** — `fetchReferenceSites()` auto-scrapes **in parallel** with step 1:
   - `premierinjuries.com/injury-table.php` — injury data
   - `rotowire.com/soccer/lineups.php` — expected lineups
   - `live-footballontv.com` — UK TV broadcast listings
3. **Stats** — `fetchMatchStats()` via Perplexity pulls WhoScored / FootyStats / SoccerStats data.
4. **Write** — With CRITICAL ACCURACY RULES: every sentence must contain a specific fact; omit sections without real data; no generic filler; quotes must be real.
5. **Hallucination scan** — same as standard but findings saved to feedback memory.
6. **QC + auto-retry** — up to 3 attempts (see below).
7. **E-E-A-T polish**.

### Auto-Retry QC Loop (`retryUntilPass`)

QC-FAIL articles **never reach the editor without exhausting automated fixes**:

```
Write → QC
  → PASS → E-E-A-T
  → FAIL → rewrite with ALL accumulated issues → QC (attempt 2)
    → PASS → E-E-A-T
    → FAIL → rewrite with ALL accumulated issues → QC (attempt 3)
      → PASS → E-E-A-T
      → FAIL → save all issues to feedback memory → surface with red badge
```

Each retry carries the **full accumulated issues** from every previous pass. Issues are deduplicated. Feedback is saved whether QC passes on retry or exhausts all attempts.

---

## Football Category Templates

14 expert journalist templates auto-fill the Custom Topic description when a category is selected with Football as the sport. Written from combined perspectives:
- **Editor** — angles, completeness, what readers need
- **Football Expert** — tactical depth, specific stats to source
- **Writer** — narrative structure, how to open each section
- **QC Agent** — verifiability, what must be confirmed not assumed

Templates: Season Analysis, Transfer News, Injury Updates, Competition Guides, Broadcaster Guides, Team Guides, Manager Features, Player Features, Match Previews, Match Reports, Club News, Awards, Fan Features, Fixture Analysis.

Templates use `[CLUB]` placeholder replaced with the selected club name. Auto-fill only triggers if the textarea is empty or was previously auto-filled (user edits are never overwritten).

---

## Feedback Memory (Learning System)

### Storage: Cloudflare Workers KV

Permanent, cross-device, edge-distributed. No TTL — entries persist forever.

**Worker routes:**
- `GET /api/feedback` — returns all entries from KV
- `POST /api/feedback` — adds entry with deduplication
- `DELETE /api/feedback` — clears all entries (admin)

**KV namespace:** `FEEDBACK` (id: `5b31d7cca89744d0a9761e302eb19436`)

**Frontend:** `loadFeedbackFromServer()` fetches at init → caches in `S.feedbackMemory`. `saveFeedbackEntry()` POSTs to server + updates cache. Falls back to localStorage if offline.

### Entry Schema

```javascript
{
  id: 'fb-1712345678000-a3x9',
  category: 'Match Previews',
  typeId: 'preview',
  sport: 'football',
  model: 'google/gemini-2.5-flash',
  source: 'human' | 'auto-hallucination' | 'auto-qc-corrected' | 'auto-qc-exhausted',
  articleTitle: 'Manchester United vs Leeds...',
  feedback: 'Too much generic filler...',
  qcIssues: [{ severity: 'critical', description: '...' }],
  timestamp: 1712345678000
}
```

### What Triggers Feedback Saves

| Trigger | Source type | When |
|---------|-----------|------|
| Hallucination scan strips items | `auto-hallucination` | Every scan that finds items (4 locations) |
| QC passes on retry 2 or 3 | `auto-qc-corrected` | Retry succeeds but issues were found |
| QC exhausts all 3 attempts | `auto-qc-exhausted` | All retries failed |
| Human clicks Feedback button | `human` | Editor provides specific notes |

### Model-Aware Learning

`buildFeedbackLessons(currentModel)` produces two tiers:

| Scenario | Framing in prompt |
|----------|------------------|
| Same model made the mistake | **YOUR DIRECT FEEDBACK:** (harshest — repeating = critical failure) |
| Different model made it | **SHARED KNOWLEDGE (from [model name]):** (advisory — but repeating after warning is worse) |

Injected into:
- `getSystemPrompt()` → "EDITORIAL LESSONS LEARNED"
- `getQcSystem()` → "HISTORICAL EDITORIAL FEEDBACK — EXTRA STRICT, automatic FAIL"

### Human Feedback UI

Purple **Feedback** button on every article card. Opens a collapsible panel with:
- Textarea for editorial notes
- **Reprocess Article** button → runs full pipeline: rewrite with feedback → hallucination scan → QC (with retry loop) → E-E-A-T → SEO
- Article updates **in place** (same index in `S.generated`)
- Feedback saved to KV before reprocessing begins
- `feedbackHistory` array on the article object tracks all editorial notes

---

## Match Infographics

### How it works

The infographic system extracts real match stats from BBC Sport pages and renders them as visual comparison bars in the article. **No LLM is used** — the stats are extracted deterministically from BBC's embedded `__INITIAL_DATA__` JSON.

### Architecture

```
User pastes BBC Sport URL → clicks "Fetch Stats"
  → Frontend calls POST /api/match-stats
  → Worker fetches BBC page HTML
  → parseBbcMatchStats() extracts __INITIAL_DATA__ JSON
  → Unescapes the double-escaped string
  → Finds "alignment":"home","stats":{ pattern (unique in the page)
  → Extracts: possession, shots, shots on target, corners, fouls,
    passes, pass accuracy, tackles, saves, offsides, xG
  → Extracts team names from 300 chars before the stats marker
  → Extracts score from accessible text: "Team A 1 , Team B 2 at Full time"
  → Returns structured JSON: { homeTeam, awayTeam, score, competition, stats[] }
  → Frontend renderInfographicHtml(data) builds visual HTML deterministically
  → HTML stored in S.infographicData.html, ready for article insertion
```

### Key design decisions

1. **No LLM for HTML generation** — asking models to output styled HTML with CSS classes was unreliable (produced header-only output). The JavaScript `renderInfographicHtml()` function builds guaranteed-correct HTML from the JSON data.
2. **No Perplexity for stats** — Perplexity returned wrong matches (cached/guessed data). Direct BBC page parsing is deterministic and free.
3. **Pattern: `"alignment":"home","stats":{`** — BBC pages contain team names dozens of times (header, commentary, lineups) but only ONE occurrence has this alignment+stats pattern. This is the reliable anchor.
4. **Zero tokens, instant response** — just an HTTP fetch + regex parsing.

### CSS classes (in article inline styles)

| Class | Purpose |
|-------|---------|
| `.wc-infographic` | Outer container — dark gradient background |
| `.wc-infographic-title` | "MATCH STATISTICS" header — gold, uppercase |
| `.wc-match-score` | Team names + score + meta row |
| `.wc-stat-row` | Flex container for each stat (bar or label) |
| `.wc-sr-val` | Value display (left/right of bar) |
| `.wc-sr-bar-wrap` | Bar container |
| `.wc-sr-bar-home` | Blue bar (proportional width) |
| `.wc-sr-bar-away` | Red bar (proportional width) |
| `.wc-sr-label` | Stat name (centred below the bar) |

### Insertion

`insertAtPercent(body, html, 0.4)` places the infographic at 40% through the article, before the nearest `<h2>`. The sport banner goes at 65%. They are never adjacent.

### Worker route

`POST /api/match-stats` — accepts `{ statsUrl }`, returns `{ homeTeam, awayTeam, score, competition, stats[] }`. Only BBC Sport URLs are supported.

---

## Match Preview / Report Quality Rules

### Banned Phrases (in match articles — automatic QC failure)

"both teams will be looking to", "is expected to be", "could pose challenges", "promises to be an exciting", "eager to", "determined to make their mark", "will aim to leverage", "the outcome often hinges on", "tactical discipline being key", "a closely fought encounter", "will be looking to impose their style", "according to recent reports", "data suggests"

### Section Omission Rule

If a section (e.g. Team News) has no specific data from the research, it must be **omitted entirely** — never filled with generic text. A shorter article with real facts beats a longer article with waffle.

### Pullquote Rule

Must be a REAL quote from a real person in the source. If no quotes exist, use a strong stat (e.g. "W4 D0 L1 — Team's record in the last 5 home matches") with the source as attribution. Never fabricate quotes.

### Reference Sites (auto-fetched for football match articles)

| Site | Data provided |
|------|--------------|
| `premierinjuries.com/injury-table.php` | PL injury table — player names, injury types, return dates |
| `rotowire.com/soccer/lineups.php` | Expected lineups for EPL, UCL, La Liga, Serie A, Bundesliga, MLS |
| `live-footballontv.com` | UK TV channel, kick-off time, streaming options |

---

## Article Object Schema

```javascript
{
  spec: { title, category, keywords, team, typeId, isTopical, source },
  wp: '...WordPress HTML block...',
  seo: { h1, titleOptions, metaOptions, urlSlug, tags, keyphrases, keyphraseMatches, allKeywords },
  status: 'done',
  articleLength: 'standard' | 'medium' | 'longform' | 'custom',
  qc: { verdict, confidence, issues, verified_facts },
  model: 'google/gemini-2.5-flash',
  matchContext: '...truncated research context for reprocessing...',
  feedbackHistory: [{ text, timestamp }],
  needsReview: false,
  wasRewritten: false,
  eeatPolished: true,
  savedAt: 1712345678000,
  wlOptions: null | { domain, author, noBanners }
}
```

---

## SEO Fields

`genSeoFields(spec, articleBody)` receives the article draft body so keyphrases are grounded in actual content.

| Field | Detail |
|-------|--------|
| `h1` | Keyword-rich headline, under 80 chars |
| `titleOptions` | 5 SEO title options, 50-65 chars each |
| `metaOptions` | 2 meta description options, 120-160 chars |
| `urlSlug` | Keyword-first, lowercase, hyphenated |
| `tags` | Up to 10 tags |
| `keyphrases` | 3 focus keyphrases, verified verbatim in article |
| `allKeywords` | 10-15 individual keywords |

---

## White Label Mode

Toggled via the **White Label** checkbox. Sets `CURRENT_WL` at pipeline start.

Effects: author override or anonymous (no byline/editors-note), domain override in schema, banners suppressed, blue badge on card, `wlOptions` persisted on article object.

---

## DOCX Export

Available on every article card. Uses `html-docx-js` CDN. `buildCleanHtml(wp)` strips SEO/schema/banners/tags, converts pullquotes to blockquotes. `downloadDocx(idx)` triggers download.

---

## Cloudflare Worker

### Secrets
| Secret | Purpose |
|--------|---------|
| `OPENROUTER_API_KEY` | Authenticates OpenRouter API calls |
| `WC_SECRET` | Token auth — frontend must send matching `X-WC-Token` |

### KV Bindings
| Binding | Namespace ID | Purpose |
|---------|-------------|---------|
| `FEEDBACK` | `5b31d7cca89744d0a9761e302eb19436` | Permanent feedback/learning memory |

### Routes
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/messages` | POST | Proxy to OpenRouter API |
| `/api/rss` | GET | Fetch + parse RSS feeds by sport |
| `/api/fetch-article` | POST | Extract text from any URL |
| `/api/feedback` | GET | Read all feedback entries from KV |
| `/api/feedback` | POST | Add feedback entry to KV |
| `/api/feedback` | DELETE | Clear all feedback entries |

### Deployment
```bash
cd worker
npx wrangler deploy
```

CORS: `Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS`
`Access-Control-Allow-Headers: Content-Type, X-WC-Token`

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
| Perplexity | Sonar, Sonar Pro (live web access) |

### Hardcoded models
- `FREE_MODEL = google/gemini-2.5-flash` — analysis, QC, SEO, hallucination scan
- `RESEARCH_MODEL = perplexity/sonar-pro` — pre-research and match stats

Article cards show a **purple model badge** indicating which model wrote each article.

---

## GitHub Pages Deployment

Deploys from `main` branch, `/docs` folder. After `git push`, rebuilds in ~2 minutes.
Always test in incognito (Ctrl+Shift+N) or hard-refresh (Ctrl+Shift+R).

---

## Security

- Frontend HTML is public (required for free GitHub Pages)
- `WC_TOKEN` visible in source — OpenRouter spend cap limits damage
- `OPENROUTER_API_KEY` stored only as Cloudflare Worker secret
- **OpenRouter spend cap**: https://openrouter.ai/settings/limits
- CORS `ALLOWED_ORIGINS` blocks other websites
- `WC_SECRET` blocks direct API abuse

---

## Known Issues & Past Fixes

| Issue | Fix |
|-------|-----|
| Free models rate-limit | Removed; paid models only |
| Generic filler in match articles | Banned phrases list + `generic_filler` hallucination category + section omission rule |
| Fabricated pullquotes | `fabricated_quote` hallucination category + real-quotes-only match rule |
| QC FAIL articles reaching editor | Auto-retry loop (3 attempts) with accumulated issues |
| No learning from mistakes | Cloudflare KV feedback memory + model-aware prompt injection |
| Feedback lost on browser clear | Migrated from localStorage to KV API (permanent, cross-device) |
| Missing injury data | Auto-fetch premierinjuries.com + Perplexity checks |
| Missing TV channel info | Auto-fetch live-footballontv.com + explicit Perplexity instruction |
| Truncated RSS quotes | 3-layer fix: prompt rule + `truncated_quote` scan + `cleanMarkdown()` regex |
| Articles lost on refresh | localStorage persistence with 7-day auto-expiry |
| AI using stale training knowledge | Perplexity pre-research + source-only rules + traceability QC |

---

## Editorial Standards

Full brief at: `C:\Users\Dj4be\Documents\Blog articles claude\PROJECT-BRIEF.md`

Key rules:
- British English throughout
- WhatChan articles by **Adrian Dane** — white label uses client author or anonymous
- No clichés, no padding, no repetition
- Facts only from source/verified context — never invented
- No placeholder text, no em dashes in prose
- Time-sensitive facts only from source — never from training
- Never reproduce truncated quotes
- Every sentence in match articles must contain a specific fact
- Reference sites (premierinjuries.com, rotowire.com, live-footballontv.com) must be checked for match articles
