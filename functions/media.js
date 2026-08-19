/**
 * /api/media  —  stream an X CDN media file back to the browser as a
 * Content-Disposition: attachment so the browser saves it directly.
 *
 *   GET /api/media?src=<media url>&name=<filename>&inline=1
 *
 * Only X's own CDNs (pbs.twimg.com / video.twimg.com / abs.twimg.com) are
 * proxied — this is a media downloader, not a general open proxy.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const ALLOWED_HOSTS = [
  /^https:\/\/pbs\.twimg\.com\//,
  /^https:\/\/video\.twimg\.com\//,
  /^https:\/\/abs\.twimg\.com\//,
];

const MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  webm: "video/webm",
};

function sanitizeFilename(name) {
  const base = String(name || "media").replace(/\.[a-z0-9]{2,5}$/i, "");
  const clean = base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "media";
  const m = String(name || "").match(/\.([a-z0-9]{2,5})$/i);
  const ext = m ? m[1].toLowerCase() : "bin";
  return `${clean}.${ext}`;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const q = event.queryStringParameters || {};
  const src = q.src || "";
  const name = q.name || "media";
  const inline = q.inline === "1";

  if (!src || !ALLOWED_HOSTS.some((re) => re.test(src))) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json", ...CORS },
      body: JSON.stringify({
        error: "BAD_SRC",
        message: "Only media URLs from X's CDNs (twimg.com) can be proxied.",
      }),
    };
  }

  const filename = sanitizeFilename(name);
  const ext = (filename.split(".").pop() || "").toLowerCase();

  // HEAD: answer with headers only (used by the UI to show file sizes).
  // video.twimg.com 403s browser fetches that carry a Referer, so the UI
  // probes video sizes through this endpoint instead of the CDN directly.
  if (event.httpMethod === "HEAD") {
    let upstream;
    try {
      upstream = await fetch(src, { method: "HEAD", headers: { "User-Agent": UA }, redirect: "follow" });
    } catch (e) {
      return { statusCode: 502, headers: { ...CORS }, body: "" };
    }
    if (!upstream.ok) {
      return { statusCode: 502, headers: { ...CORS }, body: "" };
    }
    const headers = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      ...CORS,
    };
    const len = upstream.headers.get("content-length");
    if (len) headers["Content-Length"] = len;
    return { statusCode: 200, headers, body: "" };
  }

  let upstream;
  try {
    upstream = await fetch(src, {
      headers: { "User-Agent": UA },
      redirect: "follow",
    });
  } catch (e) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json", ...CORS },
      body: JSON.stringify({ error: "UPSTREAM", message: "Could not fetch the file from X's CDN." }),
    };
  }

  if (!upstream.ok) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json", ...CORS },
      body: JSON.stringify({
        error: "UPSTREAM",
        message: `X's CDN answered ${upstream.status} for that file.`,
      }),
    };
  }

  const headers = {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=3600",
  };
  const len = upstream.headers.get("content-length");
  if (len) headers["Content-Length"] = len;

  // Stream when the runtime gives us a Web ReadableStream (Node 18+);
  // otherwise buffer (with a sanity cap).
  if (upstream.body && typeof upstream.body.getReader === "function") {
    return { statusCode: 200, headers, body: upstream.body };
  }

  const MAX_BUFFER = 500 * 1024 * 1024; // 500 MB
  if (len && Number(len) > MAX_BUFFER) {
    return {
      statusCode: 413,
      headers: { "Content-Type": "application/json", ...CORS },
      body: JSON.stringify({
        error: "TOO_LARGE",
        message: "That file is too large to proxy. Use the “Open original” link instead.",
      }),
    };
  }
  const buf = await upstream.arrayBuffer();
  if (buf.byteLength > MAX_BUFFER) {
    return {
      statusCode: 413,
      headers: { "Content-Type": "application/json", ...CORS },
      body: JSON.stringify({ error: "TOO_LARGE", message: "File too large to proxy." }),
    };
  }
  return { statusCode: 200, headers, body: Buffer.from(buf).toString("base64"), isBase64Encoded: true };
};
