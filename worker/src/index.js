// Cloudflare Worker — proxies OpenRouter API + RSS feeds + URL extraction
// API key stored as Cloudflare secret, never exposed to browser

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';

// Sport-specific RSS feeds
const RSS_FEEDS = {
  football: {
    bbc:      'https://feeds.bbci.co.uk/sport/football/rss.xml',
    sky:      'https://www.skysports.com/rss/12040',
    athletic: 'https://theathletic.com/feeds/rss/news/',
    guardian:  'https://www.theguardian.com/football/rss',
  },
  darts: {
    bbc:      'https://feeds.bbci.co.uk/sport/darts/rss.xml',
    sky:      'https://www.skysports.com/rss/12188',
    pdc:      'https://www.pdc.tv/news/rss.xml',
  },
  boxing: {
    bbc:      'https://feeds.bbci.co.uk/sport/boxing/rss.xml',
    sky:      'https://www.skysports.com/rss/12183',
    guardian:  'https://www.theguardian.com/sport/boxing/rss',
  },
  snooker: {
    bbc:      'https://feeds.bbci.co.uk/sport/snooker/rss.xml',
    eurosport: 'https://www.eurosport.com/snooker/rss.xml',
  },
  f1: {
    bbc:      'https://feeds.bbci.co.uk/sport/formula1/rss.xml',
    sky:      'https://www.skysports.com/rss/12433',
    guardian:  'https://www.theguardian.com/sport/formulaone/rss',
    autosport: 'https://www.autosport.com/rss/f1/news/',
  },
  rugby: {
    bbc:      'https://feeds.bbci.co.uk/sport/rugby-union/rss.xml',
    sky:      'https://www.skysports.com/rss/12321',
    guardian:  'https://www.theguardian.com/sport/rugby-union/rss',
  },
};

// Origins allowed to call this worker
const ALLOWED_ORIGINS = [
  'https://dj4beat.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'null',                               // local file:// origin
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) || origin === 'null';
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-WC-Token',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// ── RSS feed parsing (basic XML → JSON) ──
function parseRssXml(xml, source) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, 's'));
      return m ? m[1].trim() : '';
    };
    items.push({
      title: get('title').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#039;/g, "'").replace(/&quot;/g, '"'),
      link: get('link') || get('guid'),
      description: get('description').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#039;/g, "'").replace(/&quot;/g, '"').slice(0, 200),
      pubDate: get('pubDate'),
      source,
    });
  }
  return items;
}

// ── Extract article text from a URL ──
function extractArticleText(html) {
  // Remove scripts, styles, nav, header, footer, aside
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '');

  // Try to find article body
  const articleMatch = text.match(/<article[\s\S]*?<\/article>/i);
  if (articleMatch) text = articleMatch[0];

  // Strip remaining tags, decode entities, clean whitespace
  text = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#039;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s{3,}/g, '\n\n')
    .trim();

  return text.slice(0, 8000); // cap at 8k chars
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);
    const url = new URL(request.url);

    // ── CORS preflight ──
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // ── Token check — reject requests without valid X-WC-Token ──
    const token = request.headers.get('X-WC-Token') || '';
    if (env.WC_SECRET && token !== env.WC_SECRET) {
      return jsonResponse({ error: 'Unauthorised' }, 401, cors);
    }

    // ── Route: POST /api/messages → OpenRouter ──
    if (url.pathname === '/api/messages' && request.method === 'POST') {
      const body = await request.text();

      const orResponse = await fetch(OPENROUTER_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://whatchan.co.uk',
          'X-Title': 'WhatChan Article Generator',
        },
        body,
      });

      const responseHeaders = new Headers(cors);
      responseHeaders.set('Content-Type', 'application/json');

      return new Response(orResponse.body, {
        status: orResponse.status,
        headers: responseHeaders,
      });
    }

    // ── Route: GET /api/rss?sport=football&source=bbc|all ──
    if (url.pathname === '/api/rss' && request.method === 'GET') {
      const sport = url.searchParams.get('sport') || 'football';
      const source = url.searchParams.get('source') || 'all';
      const sportFeeds = RSS_FEEDS[sport] || RSS_FEEDS.football;
      const sources = source === 'all' ? Object.keys(sportFeeds) : [source];

      const results = await Promise.allSettled(
        sources.filter(s => sportFeeds[s]).map(async (s) => {
          const res = await fetch(sportFeeds[s], {
            headers: { 'User-Agent': 'WhatChan-ArticleBot/1.0' },
            cf: { cacheTtl: 300 }, // cache 5 min at edge
          });
          if (!res.ok) return [];
          const xml = await res.text();
          return parseRssXml(xml, s);
        })
      );

      const items = results
        .filter(r => r.status === 'fulfilled')
        .flatMap(r => r.value)
        .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
        .slice(0, 60);

      return jsonResponse({ items, fetched: new Date().toISOString() }, 200, cors);
    }

    // ── Route: POST /api/fetch-article → extract text from URL ──
    if (url.pathname === '/api/fetch-article' && request.method === 'POST') {
      try {
        const { articleUrl } = await request.json();
        if (!articleUrl) return jsonResponse({ error: 'Missing articleUrl' }, 400, cors);

        const res = await fetch(articleUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WhatChan-Bot/1.0)' },
          redirect: 'follow',
        });
        if (!res.ok) return jsonResponse({ error: 'Failed to fetch: ' + res.status }, res.status, cors);

        const html = await res.text();
        const text = extractArticleText(html);
        const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
        const title = titleMatch
          ? titleMatch[1].replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"').trim()
          : '';

        return jsonResponse({ title, text, url: articleUrl }, 200, cors);
      } catch (e) {
        return jsonResponse({ error: e.message }, 500, cors);
      }
    }

    // ── Route: GET /api/feedback → read all feedback entries from KV ──
    if (url.pathname === '/api/feedback' && request.method === 'GET') {
      try {
        const raw = await env.FEEDBACK.get('entries');
        const entries = raw ? JSON.parse(raw) : [];
        return jsonResponse({ entries, count: entries.length }, 200, cors);
      } catch (e) {
        return jsonResponse({ entries: [], error: e.message }, 200, cors);
      }
    }

    // ── Route: POST /api/feedback → add a feedback entry to KV ──
    if (url.pathname === '/api/feedback' && request.method === 'POST') {
      try {
        const { entry } = await request.json();
        if (!entry || !entry.feedback) return jsonResponse({ error: 'Missing entry.feedback' }, 400, cors);

        // Read existing entries
        const raw = await env.FEEDBACK.get('entries');
        const entries = raw ? JSON.parse(raw) : [];

        // Deduplicate: skip if same typeId + first 80 chars of feedback already exists
        const prefix = (entry.feedback || '').slice(0, 80);
        const isDupe = entries.some(e => e.typeId === entry.typeId && (e.feedback || '').slice(0, 80) === prefix);

        if (!isDupe) {
          // Add unique ID if not present
          if (!entry.id) entry.id = 'fb-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
          entries.push(entry);
          await env.FEEDBACK.put('entries', JSON.stringify(entries));
        }

        return jsonResponse({ entries, count: entries.length, added: !isDupe }, 200, cors);
      } catch (e) {
        return jsonResponse({ error: e.message }, 500, cors);
      }
    }

    // ── Route: DELETE /api/feedback → clear all feedback entries (admin) ──
    if (url.pathname === '/api/feedback' && request.method === 'DELETE') {
      try {
        await env.FEEDBACK.delete('entries');
        return jsonResponse({ cleared: true }, 200, cors);
      } catch (e) {
        return jsonResponse({ error: e.message }, 500, cors);
      }
    }

    // ── 404 ──
    return jsonResponse({ error: 'Not found' }, 404, cors);
  },
};
