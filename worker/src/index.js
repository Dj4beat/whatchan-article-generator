// Cloudflare Worker — proxies OpenRouter API + RSS feeds + URL extraction + match stats
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
  'null',
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
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '');
  const articleMatch = text.match(/<article[\s\S]*?<\/article>/i);
  if (articleMatch) text = articleMatch[0];
  text = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#039;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s{3,}/g, '\n\n')
    .trim();
  return text.slice(0, 8000);
}

// ── BBC Sport match stats parser ──
// Extracts structured stats from the __INITIAL_DATA__ JSON embedded in BBC Sport pages.
// Strategy: find the sportDataEvent block (the main match), then extract home/away stats
// by searching near each team's fullName for the "stats":{...} block.
function parseBbcMatchStats(html) {
  const m = html.match(/window\.__INITIAL_DATA__="([\s\S]*?)";/);
  if (!m) throw new Error('No __INITIAL_DATA__ found — is this a BBC Sport page?');

  // Unescape the double-escaped JSON string
  const raw = m[1].replace(/\\\\"/g, '"').replace(/\\"/g, '"');

  // Find the sportDataEvent which contains the main match for this page
  const eventIdx = raw.indexOf('"sportDataEvent"');
  if (eventIdx < 0) throw new Error('No sportDataEvent — this may not be a match page');

  // Extract a large block after sportDataEvent to work with
  const eventBlock = raw.slice(eventIdx, eventIdx + 30000);

  // Get team names from the stats blocks (most reliable — right next to the stats)
  const homeStatsMarker = raw.indexOf('"alignment":"home","stats":{');
  const awayStatsMarker = raw.indexOf('"alignment":"away","stats":{');
  let homeTeam = 'Home', awayTeam = 'Away';

  if (homeStatsMarker > 0) {
    const before = raw.slice(Math.max(0, homeStatsMarker - 300), homeStatsMarker);
    const nameMatch = before.match(/"fullName":"([^"]+)"/);
    if (nameMatch) homeTeam = nameMatch[1];
  }
  if (awayStatsMarker > 0) {
    const before = raw.slice(Math.max(0, awayStatsMarker - 300), awayStatsMarker);
    const nameMatch = before.match(/"fullName":"([^"]+)"/);
    if (nameMatch) awayTeam = nameMatch[1];
  }

  // Get score — most reliable pattern is the accessible text: "Team A 1 , Team B 2 at Full time"
  let score = 'vs';
  const scoreAccessible = raw.match(/(\d+)\s*,\s*[^"]*?\s(\d+)\s*at Full time/);
  if (scoreAccessible) {
    score = scoreAccessible[1] + '-' + scoreAccessible[2];
  } else {
    // Fallback: fulltime scores near team names
    const homeFt = raw.match(new RegExp('"fullName":"' + homeTeam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^}]*?"fulltime":"(\\d+)"'));
    const awayFt = raw.match(new RegExp('"fullName":"' + awayTeam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^}]*?"fulltime":"(\\d+)"'));
    if (homeFt && awayFt) score = homeFt[1] + '-' + awayFt[1];
  }

  // Competition
  const compMatch = eventBlock.match(/"tournamentName":"([^"]+)"/);
  const competition = compMatch ? compMatch[1] : '';

  // Extract stats by finding "alignment":"home/away","stats":{ pattern directly
  // This is more reliable than searching by team name because the page may have
  // multiple matches — but only one block has alignment+stats together.
  function extractStats(alignment) {
    const marker = '"alignment":"' + alignment + '","stats":{';
    const markerIdx = raw.indexOf(marker);
    if (markerIdx < 0) return {};

    // The stats block starts right after "stats":{
    const statsStart = markerIdx + marker.length - 1; // include the opening {
    const statsChunk = raw.slice(statsStart, statsStart + 2000);
    const result = {};

    // Simple pattern: "keyName":{"total":NUMBER}
    function grab(key, label, isPct) {
      const re = new RegExp('"' + key + '":\\{"total":(\\d+\\.?\\d*)\\}');
      const sm = statsChunk.match(re);
      if (sm) {
        result[label] = isPct ? (parseFloat(sm[1]).toFixed(1) + '%') : String(Math.round(parseFloat(sm[1])));
      }
    }

    grab('possessionPercentage', 'Possession', true);
    grab('shotsTotal', 'Shots', false);
    grab('shotsOnTarget', 'Shots on Target', false);
    grab('shotsSaved', 'Saves', false);
    grab('foulsCommitted', 'Fouls', false);
    grab('cornersWon', 'Corners', false);

    // Offsides — inside "attack" sub-block
    const offMatch = statsChunk.match(/"totalOffside":\{"total":(\d+)\}/);
    if (offMatch) result['Offsides'] = offMatch[1];

    // Distribution stats — may be in a wider window
    const widerChunk = raw.slice(markerIdx, markerIdx + 3000);
    const passMatch = widerChunk.match(/"totalPass":\{"total":(\d+)\}/);
    if (passMatch) result['Passes'] = passMatch[1];
    const passAccMatch = widerChunk.match(/"accuratePassPercentage":\{"total":([\d.]+)\}/);
    if (passAccMatch) result['Pass Accuracy'] = parseFloat(passAccMatch[1]).toFixed(1) + '%';

    // Defence stats
    const tackleMatch = widerChunk.match(/"totalTackle":\{"total":(\d+)\}/);
    if (tackleMatch) result['Tackles'] = tackleMatch[1];

    // xG — search in a wider window from the marker position
    const xgWindow = raw.slice(markerIdx, markerIdx + 5000);
    const xgMatch = xgWindow.match(/"expectedGoals"[\s\S]{0,30}?"total":([\d.]+)/);
    if (xgMatch) result['Expected Goals (xG)'] = parseFloat(xgMatch[1]).toFixed(2);

    return result;
  }

  const homeStats = extractStats('home');
  const awayStats = extractStats('away');

  // Merge into ordered stats array
  const allLabels = new Set([...Object.keys(homeStats), ...Object.keys(awayStats)]);
  const stats = [];
  const order = ['Possession', 'Shots', 'Shots on Target', 'Expected Goals (xG)', 'Corners', 'Fouls', 'Passes', 'Pass Accuracy', 'Tackles', 'Saves', 'Offsides'];

  for (const label of order) {
    if (allLabels.has(label)) {
      stats.push({
        label,
        home: String(homeStats[label] !== undefined ? homeStats[label] : '0'),
        away: String(awayStats[label] !== undefined ? awayStats[label] : '0'),
      });
      allLabels.delete(label);
    }
  }
  for (const label of allLabels) {
    stats.push({
      label,
      home: String(homeStats[label] || '0'),
      away: String(awayStats[label] || '0'),
    });
  }

  if (stats.length === 0) throw new Error('Stats block found but individual stats could not be parsed');

  return { homeTeam, awayTeam, score, competition, stats };
}

// ── BBC team data parser — extracts fixtures, results, and match report links ──
// Works on the scores-fixtures page: /sport/football/teams/[slug]/scores-fixtures
function parseBbcTeamData(html, pageType) {
  const m = html.match(/window\.__INITIAL_DATA__="([\s\S]*?)";/);
  if (!m) throw new Error('No __INITIAL_DATA__ on this BBC page');
  const raw = m[1].replace(/\\\\"/g, '"').replace(/\\"/g, '"');

  const results = [];
  const fixtures = [];

  // Parse all events (PostEvent = completed, PreEvent = upcoming)
  const eventRe = /(PostEvent|PreEvent)/g;
  let em;
  while ((em = eventRe.exec(raw)) !== null) {
    const type = em[1]; // PostEvent or PreEvent
    const beforeChunk = raw.slice(Math.max(0, em.index - 400), em.index);
    const afterChunk = raw.slice(em.index, em.index + 600);
    const fullChunk = beforeChunk + afterChunk;

    // Extract date
    const dateMatch = beforeChunk.match(/"longDate":"([^"]+)"/);
    const isoMatch = beforeChunk.match(/"isoDate":"([^"]+)"/);
    const timeMatch = beforeChunk.match(/"displayTimeUK":"([^"]+)"/);

    // Extract teams and scores from the participants
    const teams = afterChunk.match(/"fullName":"([^"]+)"/g) || [];
    const scores = afterChunk.match(/"fulltimeScore":"(\d+)"/g) || [];
    const alignments = afterChunk.match(/"alignment":"(home|away)"/g) || [];

    if (teams.length >= 2) {
      const t1 = teams[0].replace(/"fullName":"/,'').replace(/"/,'');
      const t2 = teams[1].replace(/"fullName":"/,'').replace(/"/,'');
      const a1 = alignments[0] ? alignments[0].replace(/"alignment":"/,'').replace(/"/,'') : 'home';
      const a2 = alignments[1] ? alignments[1].replace(/"alignment":"/,'').replace(/"/,'') : 'away';

      const event = {
        date: dateMatch ? dateMatch[1] : '',
        isoDate: isoMatch ? isoMatch[1] : '',
        time: timeMatch ? timeMatch[1] : '',
        homeTeam: a1 === 'home' ? t1 : t2,
        awayTeam: a1 === 'away' ? t1 : t2,
      };

      if (type === 'PostEvent' && scores.length >= 2) {
        const s1 = scores[0].replace(/"fulltimeScore":"/,'').replace(/"/,'');
        const s2 = scores[1].replace(/"fulltimeScore":"/,'').replace(/"/,'');
        event.homeScore = a1 === 'home' ? s1 : s2;
        event.awayScore = a1 === 'home' ? s2 : s1;
        event.score = event.homeScore + '-' + event.awayScore;

        // Try to find match report URL
        const urlMatch = fullChunk.match(/\/sport\/football\/live\/([a-z0-9]+)/);
        if (urlMatch) event.reportUrl = 'https://www.bbc.com/sport/football/live/' + urlMatch[1];

        // Competition
        const compMatch = afterChunk.match(/"name":"([^"]+)"/);
        if (compMatch) event.competition = compMatch[1];

        results.push(event);
      } else if (type === 'PreEvent') {
        const compMatch = afterChunk.match(/"name":"([^"]+)"/);
        if (compMatch) event.competition = compMatch[1];
        fixtures.push(event);
      }
    }
  }

  return { results, fixtures };
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

    // ── Token check ──
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
      return new Response(orResponse.body, { status: orResponse.status, headers: responseHeaders });
    }

    // ── Route: GET /api/rss ──
    if (url.pathname === '/api/rss' && request.method === 'GET') {
      const sport = url.searchParams.get('sport') || 'football';
      const source = url.searchParams.get('source') || 'all';
      const sportFeeds = RSS_FEEDS[sport] || RSS_FEEDS.football;
      const sources = source === 'all' ? Object.keys(sportFeeds) : [source];
      const results = await Promise.allSettled(
        sources.filter(s => sportFeeds[s]).map(async (s) => {
          const res = await fetch(sportFeeds[s], {
            headers: { 'User-Agent': 'WhatChan-ArticleBot/1.0' },
            cf: { cacheTtl: 300 },
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

    // ── Route: POST /api/fetch-article ──
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

    // ── Route: POST /api/team-data → BBC team fixtures, results, match reports ──
    if (url.pathname === '/api/team-data' && request.method === 'POST') {
      try {
        const body = await request.json();
        const teamSlug = body.teamSlug; // e.g. "grimsby-town"
        if (!teamSlug) return jsonResponse({ error: 'Missing teamSlug' }, 400, cors);

        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

        // Fetch fixtures page (upcoming matches)
        const fixturesUrl = 'https://www.bbc.com/sport/football/teams/' + teamSlug + '/scores-fixtures';
        const fixturesRes = await fetch(fixturesUrl, { headers: { 'User-Agent': ua }, redirect: 'follow' });
        let fixtures = [], results = [];
        if (fixturesRes.ok) {
          const fixturesHtml = await fixturesRes.text();
          const fixturesData = parseBbcTeamData(fixturesHtml, 'fixtures');
          fixtures = fixturesData.fixtures;
          results = results.concat(fixturesData.results);
        }

        // Fetch results page (recent completed matches)
        const resultsUrl = fixturesUrl + '?filter=results';
        const resultsRes = await fetch(resultsUrl, { headers: { 'User-Agent': ua }, redirect: 'follow' });
        if (resultsRes.ok) {
          const resultsHtml = await resultsRes.text();
          const resultsData = parseBbcTeamData(resultsHtml, 'results');
          results = results.concat(resultsData.results);
        }

        // Fetch match report text for the most recent result (if available)
        let lastMatchReport = '';
        let lastMatchStats = null;
        if (results.length > 0 && results[0].reportUrl) {
          try {
            const reportRes = await fetch(results[0].reportUrl, { headers: { 'User-Agent': ua }, redirect: 'follow' });
            if (reportRes.ok) {
              const reportHtml = await reportRes.text();
              lastMatchReport = extractArticleText(reportHtml);
              try { lastMatchStats = parseBbcMatchStats(reportHtml); } catch(e) { /* stats may not be available */ }
            }
          } catch(e) { /* match report fetch failed — not critical */ }
        }

        return jsonResponse({
          teamSlug,
          fixtures,
          results,
          lastMatchReport: lastMatchReport.slice(0, 4000),
          lastMatchStats,
        }, 200, cors);
      } catch (e) {
        return jsonResponse({ error: e.message }, 500, cors);
      }
    }

    // ── Route: POST /api/match-stats → BBC Sport stats extraction ──
    if (url.pathname === '/api/match-stats' && request.method === 'POST') {
      try {
        const { statsUrl } = await request.json();
        if (!statsUrl) return jsonResponse({ error: 'Missing statsUrl' }, 400, cors);
        if (!statsUrl.includes('bbc.com/sport') && !statsUrl.includes('bbc.co.uk/sport')) {
          return jsonResponse({ error: 'Only BBC Sport URLs are supported' }, 400, cors);
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

    // ── Route: GET /api/feedback ──
    if (url.pathname === '/api/feedback' && request.method === 'GET') {
      try {
        const raw = await env.FEEDBACK.get('entries');
        const entries = raw ? JSON.parse(raw) : [];
        return jsonResponse({ entries, count: entries.length }, 200, cors);
      } catch (e) {
        return jsonResponse({ entries: [], error: e.message }, 200, cors);
      }
    }

    // ── Route: POST /api/feedback ──
    if (url.pathname === '/api/feedback' && request.method === 'POST') {
      try {
        const { entry } = await request.json();
        if (!entry || !entry.feedback) return jsonResponse({ error: 'Missing entry.feedback' }, 400, cors);
        const raw = await env.FEEDBACK.get('entries');
        const entries = raw ? JSON.parse(raw) : [];
        const prefix = (entry.feedback || '').slice(0, 80);
        const isDupe = entries.some(e => e.typeId === entry.typeId && (e.feedback || '').slice(0, 80) === prefix);
        if (!isDupe) {
          if (!entry.id) entry.id = 'fb-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
          entries.push(entry);
          await env.FEEDBACK.put('entries', JSON.stringify(entries));
        }
        return jsonResponse({ entries, count: entries.length, added: !isDupe }, 200, cors);
      } catch (e) {
        return jsonResponse({ error: e.message }, 500, cors);
      }
    }

    // ── Route: DELETE /api/feedback ──
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
