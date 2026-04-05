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

// ── BBC Sport match stats parser — extracts from __INITIAL_DATA__ JSON blob ──
function parseBbcMatchStats(html) {
  const m = html.match(/window\.__INITIAL_DATA__="([\s\S]*?)";/);
  if (!m) throw new Error('No __INITIAL_DATA__ found on this BBC page');
  const raw = m[1];

  // Find homeTeam and awayTeam blocks with stats
  const homeMatch = raw.match(/homeTeam.*?name.*?fullName.*?\\?":\s*\\?"([^"\\]+)/);
  const awayMatch = raw.match(/awayTeam.*?name.*?fullName.*?\\?":\s*\\?"([^"\\]+)/);
  const homeTeam = homeMatch ? homeMatch[1] : 'Home';
  const awayTeam = awayMatch ? awayMatch[1] : 'Away';

  // Find score
  const scoreMatch = raw.match(/homeScore.*?\\?":\s*(\d+).*?awayScore.*?\\?":\s*(\d+)/);
  const score = scoreMatch ? scoreMatch[1] + '-' + scoreMatch[2] : 'vs';

  // Find competition
  const compMatch = raw.match(/tournamentName.*?\\?":\s*\\?"([^"\\]+)/);
  const competition = compMatch ? compMatch[1] : '';

  // Extract team-level stats using the homeTeam stats block
  function extractTeamStats(teamLabel) {
    // Find the stats block for this team alignment
    const pattern = new RegExp('"alignment":"' + teamLabel + '".*?"stats":\\{(.*?)\\},"alignment"', 's');
    const altPattern = new RegExp('"alignment":"' + teamLabel + '".*?"stats":\\{(.*?)\\},', 's');
    // Simpler: just find possessionPercentage after the team alignment
    const alignIdx = raw.indexOf('"alignment":"' + teamLabel + '"');
    if (alignIdx < 0) return {};
    // Get 2000 chars after this point — covers all stats
    const chunk = raw.slice(alignIdx, alignIdx + 2000);
    const stats = {};
    const statPatterns = [
      ['possessionPercentage', 'Possession', '%'],
      ['shotsTotal', 'Shots', ''],
      ['shotsOnTarget', 'Shots on Target', ''],
      ['shotsSaved', 'Saves', ''],
      ['foulsCommitted', 'Fouls', ''],
      ['cornersWon', 'Corners', ''],
      ['totalOffside', 'Offsides', ''],
    ];
    statPatterns.forEach(([key, label, suffix]) => {
      const re = new RegExp('"' + key + '":\\{[^}]*"total":\\s*([\\d.]+)');
      const sm = chunk.match(re);
      if (sm) stats[label] = parseFloat(sm[1]) + (suffix || '');
    });
    // Also try to find xG
    const xgMatch = chunk.match(/"expectedGoals".*?"total":\s*([\d.]+)/);
    if (xgMatch) stats['Expected Goals (xG)'] = xgMatch[1];
    // Passes and pass accuracy from distribution block
    const passMatch = chunk.match(/"totalPass".*?"total":\s*(\d+)/);
    if (passMatch) stats['Passes'] = passMatch[1];
    const passAccMatch = chunk.match(/"accuratePassPercentage".*?"total":\s*([\d.]+)/);
    if (passAccMatch) stats['Pass Accuracy'] = parseFloat(passAccMatch[1]).toFixed(1) + '%';
    // Tackles
    const tackleMatch = chunk.match(/"totalTackle".*?"total":\s*(\d+)/);
    if (tackleMatch) stats['Tackles'] = tackleMatch[1];
    // Yellow/red cards
    const yellowMatch = chunk.match(/"yellowCards".*?"total":\s*(\d+)/);
    if (yellowMatch) stats['Yellow Cards'] = yellowMatch[1];
    const redMatch = chunk.match(/"redCards".*?"total":\s*(\d+)/);
    if (redMatch) stats['Red Cards'] = redMatch[1];
    return stats;
  }

  const homeStats = extractTeamStats('home');
  const awayStats = extractTeamStats('away');

  // Merge into stats array
  const allLabels = new Set([...Object.keys(homeStats), ...Object.keys(awayStats)]);
  const stats = [];
  // Preferred order
  const order = ['Possession', 'Shots', 'Shots on Target', 'Expected Goals (xG)', 'Corners', 'Fouls', 'Yellow Cards', 'Red Cards', 'Passes', 'Pass Accuracy', 'Tackles', 'Saves', 'Offsides'];
  order.forEach(label => {
    if (allLabels.has(label)) {
      const hv = homeStats[label];
      const av = awayStats[label];
      if (hv !== undefined || av !== undefined) {
        stats.push({ label, home: String(hv !== undefined ? hv : '0'), away: String(av !== undefined ? av : '0') });
      }
      allLabels.delete(label);
    }
  });
  // Any remaining stats not in preferred order
  allLabels.forEach(label => {
    stats.push({ label, home: String(homeStats[label] || '0'), away: String(awayStats[label] || '0') });
  });

  if (stats.length === 0) throw new Error('No stats could be extracted from the BBC page data');

  return { homeTeam, awayTeam, score, competition, stats };
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

    // ── Route: POST /api/match-stats → extract structured stats from BBC Sport URL ──
    if (url.pathname === '/api/match-stats' && request.method === 'POST') {
      try {
        const { statsUrl } = await request.json();
        if (!statsUrl) return jsonResponse({ error: 'Missing statsUrl' }, 400, cors);
        if (!statsUrl.includes('bbc.com/sport') && !statsUrl.includes('bbc.co.uk/sport')) {
          return jsonResponse({ error: 'Only BBC Sport URLs are supported for stats extraction' }, 400, cors);
        }

        const res = await fetch(statsUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
          redirect: 'follow',
        });
        if (!res.ok) return jsonResponse({ error: 'Failed to fetch BBC page: ' + res.status }, res.status, cors);

        const html = await res.text();
        const data = parseBbcMatchStats(html);
        return jsonResponse(data, 200, cors);
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
