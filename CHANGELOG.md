# WhatChan Article Generator — Changelog

Every version is tagged in git. To restore any version: `git checkout <tag>`.
To see all tags: `git tag -l`. To see what changed: `git diff <old-tag> <new-tag>`.

Each entry below documents **all knock-on effects** — not just what changed in the code, but what else needs to happen (worker redeployment, KV setup, config changes, testing steps).

---

## v2.2 — 5 April 2026

**Tag:** `v2.2`
**Summary:** Match infographics generated from pasted stats URLs (BBC Sport, WhoScored, ESPN).

### What changed

| Area | Change | Files affected |
|------|--------|---------------|
| **Infographic CSS** | New `.wc-infographic` class system: dark gradient background, comparison bars (blue home / red away), form guide pills (W/D/L), H2H result rows, responsive mobile layout | `docs/index.html` (article CSS block) |
| **UI controls** | "Include Infographics" checkbox with URL input field and "Fetch Stats" button | `docs/index.html` (after White Label bar) |
| **Stats fetching** | `fetchInfographicData()` uses existing `/api/fetch-article` worker route to extract stats page text | `docs/index.html` |
| **Infographic builder** | `buildInfographic(statsText, spec)` uses FREE_MODEL to parse stats and generate structured HTML with exact bar width calculations | `docs/index.html` |
| **Article insertion** | `insertInfographic()` places infographic at article midpoint (mirrors `insertMidBanner` pattern) | `docs/index.html` |
| **Pipeline wiring** | All 3 pipelines (news feed, evergreen, custom) build infographic before `buildWpBlock` when `S.infographicData` is set | `docs/index.html` (3 pipeline locations) |
| **State** | `S.infographicData` added to app state | `docs/index.html` |

### Knock-on effects

1. **No worker changes needed** — uses existing `/api/fetch-article` route
2. **No KV changes** — infographic data is not persisted
3. **Frontend only** — just `git push` is enough, no worker redeployment
4. **CSS is inline** — infographic styles are included in the article's inline CSS block, so they work in WordPress without any theme changes
5. **Infographic is optional** — only generated when checkbox is ticked AND stats have been fetched

### How to verify

1. Tick "Include Infographics" checkbox in the control bar
2. Paste a BBC Sport match stats URL (e.g. `https://www.bbc.com/sport/football/live/...#MatchStats`)
3. Click "Fetch Stats" — status should show green tick with character count
4. Generate any article (Match Report works best)
5. Preview should show dark-themed stat comparison bars at the article midpoint
6. Copy HTML → paste into WordPress → verify infographic renders correctly

---

## v2.1 — 5 April 2026

**Tag:** `v2.1`
**Summary:** Feedback loop, auto-retry QC, Cloudflare KV learning system, match pipeline overhaul, expert templates.

### What changed

| Area | Change | Files affected |
|------|--------|---------------|
| **Cloudflare KV** | Created KV namespace `FEEDBACK` for permanent learning memory | `worker/wrangler.toml` (binding added) |
| **Worker feedback API** | Added `GET/POST/DELETE /api/feedback` routes | `worker/src/index.js` |
| **Worker CORS** | Added `DELETE` to allowed methods | `worker/src/index.js` |
| **Auto-retry QC** | `retryUntilPass()` — up to 3 write+QC cycles before surfacing to editor | `docs/index.html` |
| **Feedback memory** | `saveFeedbackEntry()` POSTs to KV; `loadFeedbackFromServer()` fetches at init | `docs/index.html` |
| **Model-aware learning** | `buildFeedbackLessons(currentModel)` — direct vs shared knowledge framing | `docs/index.html` |
| **Feedback UI** | Purple "Feedback" button + panel on every article card; `reprocessWithFeedback()` | `docs/index.html` |
| **Internal audit saves** | Hallucination scan + QC retry outcomes saved to feedback memory automatically | `docs/index.html` (4 scan locations + retryUntilPass) |
| **Match research pipeline** | `preResearchMatch()` + `fetchMatchStats()` + `fetchReferenceSites()` | `docs/index.html` |
| **Reference site auto-fetch** | premierinjuries.com, rotowire.com lineups, live-footballontv.com scraped in parallel | `docs/index.html` |
| **Anti-filler rules** | 15 banned phrases, section omission gate, generic_filler + fabricated_quote hallucination categories | `docs/index.html` |
| **Expert templates** | 14 football category templates (Editor + Expert + Writer + QC perspectives) | `docs/index.html` |
| **Custom Topic restructure** | Club/Team dropdown moved above textarea; onchange triggers template fill | `docs/index.html` |
| **URL context field** | URL input in Custom Topic for pasting match reports, stats pages, TV listings | `docs/index.html` |
| **Model tracking** | `model: ACTIVE_MODEL` stored on every article object and feedback entry | `docs/index.html` |
| **Model badge** | Purple badge on article cards showing which model wrote it | `docs/index.html` |
| **Article schema** | Articles now store `matchContext` (truncated 3K) and `feedbackHistory` array | `docs/index.html` |

### Knock-on effects (what you MUST do after pulling this version)

1. **Worker MUST be redeployed** — new KV routes and CORS changes require `cd worker && npx wrangler deploy`
2. **KV namespace must exist** — if starting fresh: `cd worker && npx wrangler kv namespace create FEEDBACK`, then update `wrangler.toml` with the returned ID
3. **Existing articles** in localStorage will still load but won't have `model` or `matchContext` fields — these populate on next generation
4. **Existing feedback** in old `wc_feedback_v1` localStorage key will be read as offline fallback, then new entries go to KV
5. **OpenRouter costs** may increase slightly — match articles now make 5 Perplexity calls (2 research + 1 stats + reference sites) instead of 0
6. **QC may take longer** — auto-retry means up to 3 full QC cycles instead of 1. Each adds ~5 seconds.

### How to verify this version works

1. Open site in incognito → check Activity Log shows "Feedback memory loaded: X entries from server"
2. Generate a Match Preview for any PL club → check Activity Log shows reference site fetches
3. If QC fails → watch "QC FAIL — retry 1/3" messages in Activity Log
4. Click Feedback on any article → textarea appears → type feedback → Reprocess
5. Generate another article → check system prompt contains "EDITORIAL LESSONS LEARNED"
6. In different browser → feedback should load from KV (not empty)

---

## v2.0 — 5 April 2026 (earlier in session)

**Tag:** `v2.0`
**Summary:** White Label mode, DOCX export, localStorage persistence, expanded SEO panel, truncated quote fix.

### What changed

| Area | Change | Files affected |
|------|--------|---------------|
| **White Label mode** | Domain/author override, banner suppression, anonymous option | `docs/index.html` |
| **DOCX export** | `buildCleanHtml()` + `downloadDocx()` with html-docx-js CDN | `docs/index.html` |
| **Article persistence** | `saveArticles()` / `loadArticles()` — localStorage with 7-day TTL | `docs/index.html` |
| **SEO panel** | 5 title options, 2 meta, 10 tags, 3 keyphrases with exact-match check | `docs/index.html` |
| **Truncated quotes** | 3-layer fix: prompt rule + hallucination category + cleanMarkdown regex | `docs/index.html` |

### Knock-on effects

1. **No worker changes needed** — all changes are frontend-only
2. **CDN dependency** — `html-docx-js` loaded from unpkg.com; if CDN is down, DOCX export fails gracefully
3. **localStorage usage** — articles now persist; clearing browser data loses them
4. **White Label schema** — if domain is entered, schema.org uses that domain instead of whatchan.co.uk

---

## v1.0 — March 2026

**Tag:** `v1.0` (initial tagged release)
**Summary:** Core generator with RSS feeds, Perplexity pre-research, 6-step pipeline, multi-model support.

### What changed

Everything — initial build. Cloudflare Worker with OpenRouter proxy + RSS feeds. Frontend with News Feed, Evergreen, and Generated tabs. 20+ model selector. Pre-research via Perplexity Sonar Pro. Hallucination scan, QC, E-E-A-T pipeline. Multi-sport support.

### Knock-on effects

1. **Worker must be deployed first** — `cd worker && npx wrangler deploy`
2. **Secrets must be set** — `npx wrangler secret put OPENROUTER_API_KEY` and `npx wrangler secret put WC_SECRET`
3. **OpenRouter account required** — with credit balance and spend cap configured
4. **GitHub Pages must be enabled** — repo settings → Pages → deploy from `main` branch, `/docs` folder

---

## How to Restore a Previous Version

### Quick rollback (keeps history)

```bash
# See all tagged versions
git tag -l

# See what changed between versions
git log v2.0..v2.1 --oneline

# Revert to v2.0 (creates a new commit that undoes changes)
git revert v2.0..HEAD --no-commit
git commit -m "Revert to v2.0"
git push
```

### Hard rollback (rewrites history — use with caution)

```bash
# Reset to exact state of v2.0
git reset --hard v2.0
git push --force
```

### Worker rollback

The worker is deployed separately from the frontend. If you roll back the frontend but not the worker:
- v2.1 worker has KV feedback routes — harmless if frontend doesn't use them
- v2.0 worker has no KV routes — feedback will fall back to localStorage

To roll back the worker:
```bash
cd worker
git checkout v2.0 -- src/index.js wrangler.toml
npx wrangler deploy
```

### What to check after any rollback

1. Does the site load? (incognito, hard-refresh)
2. Does RSS feed load? (check Activity Log)
3. Can you generate an article? (try any source)
4. Does the worker respond? (check browser console for CORS errors)
5. If rolling back FROM v2.1: feedback in KV is preserved but won't be read by older frontends
