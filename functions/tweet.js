/**
 * /api/tweet  —  resolve a post URL/ID to its media.
 *
 *   GET /api/tweet?input=<url-or-id>
 *
 * Strategy:
 *   1. Parse the post ID (bare ID, /status/<id>/ URL, or follow t.co redirects).
 *   2. Primary: X's public syndication endpoint (the one embeds use).
 *   3. Fallback 1: the public fxtwitter API (api.fxtwitter.com).
 *   4. Fallback 2: the public vxtwitter API (api.vxtwitter.com).
 *
 * Returns a normalized JSON payload:
 *   { id, url, text, author:{name,screen_name,avatar}, created_at,
 *     stats:{...}, provider, media:[{type,url,thumbnail?,width?,height?,duration_millis?,ext}] }
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

// ---------------------------------------------------------------------------
// ID extraction
// ---------------------------------------------------------------------------

/** Extract a post ID from a bare ID or any status URL. Returns null if none. */
export function extractPostId(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  // Bare ID (X uses 18-19 digit snowflake IDs)
  if (/^\d{10,25}$/.test(s)) return s;
  // URL patterns: /status/<id>, /status/<id>/, /i/status/<id>
  const m = s.match(/(?:^|\/)status(?:es)?\/(\d{10,25})/i);
  if (m) return m[1];
  return null;
}

/** Build the syndication token exactly as X's own embed code does. */
export function syndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/** Ensure a twimg media URL points at the original-size asset. */
export function withOrigSize(url) {
  if (!url) return url;
  if (/[?&]name=/.test(url)) return url;
  return url + (url.includes("?") ? "&" : "?") + "name=orig";
}

function extFromUrl(url, fallback) {
  try {
    const path = new URL(url).pathname;
    const m = path.match(/\.([a-z0-9]{2,5})$/i);
    if (m) return m[1].toLowerCase();
  } catch (_) {
    /* ignore */
  }
  return fallback;
}

function canonicalPostUrl(screenName, id) {
  return `https://x.com/${screenName || "i"}/status/${id}`;
}

// ---------------------------------------------------------------------------
// Parsers (exported for testing)
// ---------------------------------------------------------------------------

/** Parse a cdn.syndication.twimg.com/tweet-result payload. */
export function parseSyndication(j) {
  if (!j || j.__typename !== "Tweet" || !j.id_str) return null;
  const media = [];

  for (const p of j.photos || []) {
    media.push({
      type: "image",
      url: withOrigSize(p.url),
      width: p.width || 0,
      height: p.height || 0,
      ext: extFromUrl(p.url, "jpg"),
    });
  }

  for (const v of j.videos || []) {
    const info = v.video_info || {};
    const variants = (info.variants || []).filter(
      (x) => x.content_type === "video/mp4" && x.url,
    );
    variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    const best = variants[0];
    if (!best) continue;
    const ar = info.aspect_ratio || [];
    const dur = info.duration_millis || 0;
    let width = 0;
    let height = 0;
    const m = best.url.match(/vid\/(\d+)x(\d+)\//);
    if (m) {
      width = Number(m[1]);
      height = Number(m[2]);
    } else if (ar.length === 2 && dur) {
      width = ar[0] > ar[1] ? ar[0] : ar[1];
      height = ar[0] > ar[1] ? ar[1] : ar[0];
    }
    media.push({
      type: "video",
      url: best.url,
      thumbnail: v.preview_image_url || "",
      duration_millis: dur,
      width,
      height,
      ext: extFromUrl(best.url, "mp4"),
    });
  }

  const u = j.user || {};
  return {
    id: j.id_str,
    url: canonicalPostUrl(u.screen_name, j.id_str),
    text: j.text || "",
    author: {
      name: u.name || "",
      screen_name: u.screen_name || "",
      avatar: u.profile_image_url_https || "",
    },
    created_at: j.created_at || "",
    stats: {
      likes: j.favorite_count || 0,
      replies: j.conversation_count || 0,
      views: null,
    },
    provider: "syndication",
    media,
  };
}

/** Parse an api.fxtwitter.com/status/<id> payload. */
export function parseFx(j) {
  const t = j && j.tweet;
  if (!t || !t.id) return null;
  const media = [];
  for (const m of (t.media && t.media.all) || []) {
    if (m.type === "video") {
      media.push({
        type: "video",
        url: m.url,
        thumbnail: m.thumbnail_url || "",
        duration_millis: m.duration_millis || 0,
        width: m.width || 0,
        height: m.height || 0,
        ext: extFromUrl(m.url, "mp4"),
      });
    } else {
      media.push({
        type: "image",
        url: withOrigSize(m.url),
        width: m.width || 0,
        height: m.height || 0,
        ext: extFromUrl(m.url, m.type === "animated_gif" || m.type === "gif" ? "gif" : "jpg"),
      });
    }
  }
  const a = t.author || {};
  return {
    id: String(t.id),
    url: t.url || canonicalPostUrl(a.screen_name, String(t.id)),
    text: t.text || "",
    author: {
      name: a.name || "",
      screen_name: a.screen_name || "",
      avatar: a.avatar_url || "",
    },
    created_at: t.created_at || "",
    stats: {
      likes: t.likes || 0,
      replies: t.replies || 0,
      views: t.views || null,
    },
    provider: "fxtwitter",
    media,
  };
}

/** Parse an api.vxtwitter.com/i/status/<id> payload (flat, no wrapper). */
export function parseVx(j) {
  if (!j || !j.id) return null;
  const media = [];
  for (const m of (j.media && j.media.all) || []) {
    if (m.type === "video") {
      media.push({
        type: "video",
        url: m.url,
        thumbnail: m.thumbnail_url || "",
        duration_millis: m.duration_millis || 0,
        width: m.width || 0,
        height: m.height || 0,
        ext: extFromUrl(m.url, "mp4"),
      });
    } else {
      media.push({
        type: "image",
        url: withOrigSize(m.url),
        width: m.width || 0,
        height: m.height || 0,
        ext: extFromUrl(m.url, m.type === "animated_gif" || m.type === "gif" ? "gif" : "jpg"),
      });
    }
  }
  const a = j.author || {};
  return {
    id: String(j.id),
    url: j.url || canonicalPostUrl(a.screen_name, String(j.id)),
    text: j.text || "",
    author: {
      name: a.name || "",
      screen_name: a.screen_name || "",
      avatar: a.avatar_url || "",
    },
    created_at: j.created_at || "",
    stats: {
      likes: j.likes || 0,
      replies: j.replies || 0,
      views: j.views || null,
    },
    provider: "vxtwitter",
    media,
  };
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

async function fetchJson(url, { timeoutMs = 12000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {
      json = null;
    }
    return { status: r.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

/** Follow a shortened link (t.co etc.) and return the final URL. */
async function resolveRedirect(url, { timeoutMs = 10000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA },
      redirect: "follow",
      signal: ctrl.signal,
    });
    // We only care about the final URL.
    return r.url || url;
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const input =
    (event.queryStringParameters && event.queryStringParameters.input) || "";

  let id = extractPostId(input);
  let resolveError = null;
  if (!id && /^https?:\/\//i.test(input.trim())) {
    // Possibly a t.co short link — follow it.
    try {
      const finalUrl = await resolveRedirect(input.trim());
      id = extractPostId(finalUrl);
    } catch (e) {
      resolveError = "Could not follow that link.";
    }
  }

  const jsonOk = (data) => ({
    statusCode: 200,
    headers: { "Content-Type": "application/json", ...CORS },
    body: JSON.stringify(data),
  });
  const jsonErr = (statusCode, error, message) => ({
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS },
    body: JSON.stringify({ error, message }),
  });

  if (!id) {
    return jsonErr(
      400,
      "BAD_INPUT",
      resolveError ||
        "That doesn't look like a post link or post ID. Try something like x.com/anyone/status/1234567890.",
    );
  }

  // 1) Syndication
  const tried = [];
  try {
    const token = syndicationToken(id);
    const r = await fetchJson(
      `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}&lang=en`,
    );
    tried.push(`syndication:${r.status}`);
    if (r.status === 200 && r.json) {
      const parsed = parseSyndication(r.json);
      if (parsed) return jsonOk(parsed);
      tried.push("syndication:200-no-parse");
    }
    if (r.status === 429) {
      return jsonErr(429, "RATE_LIMITED", "X is rate-limiting requests right now. Wait a few seconds and try again.");
    }
  } catch (e) {
    tried.push(`syndication:${e.name === "AbortError" ? "timeout" : e.message}`);
  }

  // 2) fxtwitter
  try {
    const r2 = await fetchJson(`https://api.fxtwitter.com/status/${id}`);
    if (r2.status === 200 && r2.json && r2.json.tweet) {
      const parsed = parseFx(r2.json);
      if (parsed) return jsonOk(parsed);
      tried.push("fxtwitter:200-no-parse");
    } else {
      tried.push(`fxtwitter:${r2.status}`);
    }
    if (r2.status === 404) return jsonErr(404, "NOT_FOUND", `Post ${id} not found on fxtwitter. It may be private, age-restricted, or deleted.`);
    if (r2.status === 429) {
      return jsonErr(429, "RATE_LIMITED", "The fallback service is rate-limited. Wait a few seconds and try again.");
    }
  } catch (e) {
    tried.push(`fxtwitter:${e.name === "AbortError" ? "timeout" : e.message}`);
  }

  // 3) vxtwitter (skip if API returns HTML instead of JSON)
  try {
    const r3 = await fetchJson(`https://api.vxtwitter.com/status/${id}`);
    if (r3.status === 200 && r3.json && typeof r3.json === "object" && !r3.json.title) {
      const parsed = parseVx(r3.json);
      if (parsed) return jsonOk(parsed);
      tried.push("vxtwitter:200-no-parse");
    } else {
      tried.push(`vxtwitter:${r3.status}`);
    }
  } catch (e) {
    tried.push(`vxtwitter:${e.name === "AbortError" ? "timeout" : e.message}`);
  }

  // All providers failed — report which ones and why
  const summary = tried.join(" | ");
  if (tried.some((t) => t.includes("404"))) {
    return jsonErr(404, "NOT_FOUND", `Post ${id} not found on any provider. (${summary})`);
  }
  return jsonErr(502, "ALL_PROVIDERS_FAILED", `Every lookup provider failed. (${summary})`);
};
