# WhatChan Article Generator v2

Multi-sport article generator for the WhatChan network. Supports Football, Darts, Boxing, Snooker, Formula 1 and Rugby. Powered by AI via OpenRouter.

## Architecture

```
Browser (GitHub Pages)  -->  Cloudflare Worker  -->  OpenRouter API (Claude, GPT-4o, Gemini, etc.)
                        -->  Cloudflare Worker  -->  Sport-specific RSS feeds
                        -->  Cloudflare Worker  -->  Article URL extraction
```

- **Frontend** (`docs/index.html`): Static HTML hosted on GitHub Pages
- **Proxy** (`worker/`): Cloudflare Worker that holds the OpenRouter API key and proxies all requests

## Supported Sports

| Sport | RSS Sources | Site |
|-------|------------|------|
| Football | BBC Sport, Sky Sports, The Athletic, Guardian | whatchan.co.uk |
| Darts | BBC Sport, Sky Sports, PDC | whatchan.co.uk/darts |
| Boxing | BBC Sport, Sky Sports, Guardian | whatchan.co.uk/boxing |
| Snooker | BBC Sport, Eurosport | whatchan.co.uk/snooker |
| Formula 1 | BBC Sport, Sky Sports, Guardian, Autosport | whatchan.co.uk/f1 |
| Rugby | BBC Sport, Sky Sports, Guardian | whatchan.co.uk/rugby |

## Features

- **Multi-sport**: Switch between 6 sports via the icon bar. Each sport has its own RSS feeds, topics, categories, prompts and terminology.
- **News Feed tab**: Live RSS headlines from sport-specific sources. Click any article to generate a unique WhatChan version.
- **Paste URL**: Fetch and rewrite any article from any source.
- **Evergreen tab**: Sport-specific pre-built topics and topical article builder.
- **Model selector**: Free models (Gemini Flash, Llama 3.3, DeepSeek) and paid (Claude, GPT-4o) with cost estimates.
- **4-step pipeline**: Analyse source -> Write article -> Quality check -> E-E-A-T polish.
- **File upload**: Attach PDF, DOCX, or TXT as trusted additional context.
- **WordPress-ready output**: Copy HTML with schema.org markup, SEO fields, and byline.

## Setup

### 1. Deploy the Cloudflare Worker

```bash
cd worker
npm install
npx wrangler login
npx wrangler deploy
```

Set your OpenRouter API key as a secret:

```bash
npx wrangler secret put OPENROUTER_API_KEY
# Paste your key when prompted (get one at https://openrouter.ai/settings/keys)
```

### 2. Update allowed origins

Edit `worker/src/index.js` — replace `your-username.github.io` in `ALLOWED_ORIGINS` with your GitHub Pages domain. Redeploy:

```bash
npx wrangler deploy
```

### 3. Update the frontend proxy URL

Edit `docs/index.html` — replace `PROXY_URL` at the top:

```js
var PROXY_URL = 'https://whatchan-api-proxy.your-subdomain.workers.dev';
```

### 4. Deploy to GitHub Pages

1. Push this repo to GitHub
2. Go to **Settings > Pages**
3. Source: **Deploy from a branch**, branch `main`, folder `/docs`
4. Site live at `https://your-username.github.io/repo-name/`

## Local Development

```bash
cd worker
npx wrangler dev
```

Then set `PROXY_URL` to `http://localhost:8787` in `docs/index.html` and open the file in your browser.

## Costs

- **Cloudflare Worker**: Free (100k requests/day)
- **GitHub Pages**: Free
- **OpenRouter**: Free models available; paid models charged per token
