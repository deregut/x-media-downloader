/* X Media Grab — frontend logic
 * Paste a post link/ID → fetch media metadata via /api/tweet →
 * download files via /api/media (Content-Disposition attachment) →
 * optional client-side MP3 extraction from video.
 */
"use strict";

const $ = (sel) => document.querySelector(sel);

const inputEl = $("#post-input");
const fetchBtn = $("#fetch-btn");
const statusEl = $("#status");
const resultEl = $("#result");
const tweetCardEl = $("#tweet-card");
const gridEl = $("#media-grid");
const toastEl = $("#toast");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let requestId = 0; // guards against out-of-order responses

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function formatBytes(n) {
  if (n == null || isNaN(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n;
  let i = -1;
  do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(ms) {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function formatStat(n) {
  if (n == null) return "";
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function formatDate(s) {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

let toastTimer = null;
function toast(msg, kind = "", ms = 3200) {
  toastEl.textContent = msg;
  toastEl.className = `toast ${kind}`.trim();
  toastEl.hidden = false;
  requestAnimationFrame(() => toastEl.classList.remove("hidden"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.add("hidden");
    setTimeout(() => { toastEl.hidden = true; }, 250);
  }, ms);
}

function setLoading(loading, label) {
  fetchBtn.disabled = loading;
  const span = fetchBtn.querySelector(".btn-label");
  span.textContent = loading ? "Fetching…" : "Get media";
}

function clearStatus() {
  statusEl.innerHTML = "";
}

function showStatus(kind, title, sub) {
  clearStatus();
  const box = el("div", "status-box" + (kind === "error" ? " error" : ""));
  if (kind === "loading") box.appendChild(el("div", "spinner"));
  const msg = el("div", "msg", title);
  if (sub) {
    const s = el("span", "sub", sub);
    msg.appendChild(s);
  }
  box.appendChild(msg);
  statusEl.appendChild(box);
}

// ---------------------------------------------------------------------------
// Fetch tweet metadata
// ---------------------------------------------------------------------------

async function fetchTweet(rawInput) {
  const rid = ++requestId;
  setLoading(true);
  resultEl.hidden = true;
  showStatus("loading", "Fetching post…", "Looking the link up against X.");
  try {
    const r = await fetch(`/api/tweet?input=${encodeURIComponent(rawInput)}`);
    let data = null;
    try { data = await r.json(); } catch (_) { /* non-json */ }
    if (rid !== requestId) return; // a newer request superseded this one

    if (!r.ok || !data || data.error) {
      const msg = (data && data.message) || `Request failed (${r.status}).`;
      showStatus("error", "Couldn't get that post.", msg);
      return;
    }
    clearStatus();
    try {
      renderTweet(data);
    } catch (renderErr) {
      console.error(renderErr);
      showStatus("error", "Couldn't display that post.", "The data came back in an unexpected shape. Try another post.");
    }
  } catch (e) {
    if (rid !== requestId) return;
    showStatus("error", "Network error.", "Check your connection and try again.");
  } finally {
    if (rid === requestId) setLoading(false);
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderTweet(t) {
  // --- tweet card ---
  tweetCardEl.innerHTML = "";

  const head = el("div", "tweet-head");
  const avatar = el("img", "tweet-avatar");
  avatar.alt = "";
  if (t.author && t.author.avatar) avatar.src = t.author.avatar;
  const who = el("div", "tweet-who");
  who.appendChild(el("div", "tweet-name", (t.author && t.author.name) || "Unknown"));
  const meta = el("div", "tweet-meta");
  const handle = (t.author && t.author.screen_name) ? `@${t.author.screen_name}` : "";
  meta.textContent = handle;
  if (t.created_at) {
    meta.appendChild(el("span", "dot", "·"));
    meta.appendChild(document.createTextNode(formatDate(t.created_at)));
  }
  who.appendChild(meta);
  head.appendChild(avatar);
  head.appendChild(who);
  tweetCardEl.appendChild(head);

  if (t.text) {
    const textEl = el("p", "tweet-text", t.text);
    if (t.text.length > 220) {
      textEl.classList.add("clamped");
      const more = el("button", "tweet-more", "Show more");
      more.type = "button";
      more.addEventListener("click", () => {
        textEl.classList.toggle("clamped");
        more.textContent = textEl.classList.contains("clamped") ? "Show more" : "Show less";
      });
      tweetCardEl.appendChild(textEl);
      tweetCardEl.appendChild(more);
    } else {
      tweetCardEl.appendChild(textEl);
    }
  }

  const stats = el("div", "tweet-stats");
  const s = t.stats || {};
  const parts = [];
  if (s.views != null) parts.push(["Views", s.views]);
  if (s.replies) parts.push(["Replies", s.replies]);
  if (s.likes) parts.push(["Likes", s.likes]);
  if (t.provider) parts.push(["Source", t.provider]);
  for (const [label, val] of parts) {
    const span = el("span");
    span.appendChild(document.createTextNode(`${label} `));
    const b = el("b", null, formatStat(typeof val === "number" ? val : String(val)));
    if (typeof val !== "number") b.textContent = String(val);
    span.appendChild(b);
    stats.appendChild(span);
  }
  tweetCardEl.appendChild(stats);

  // --- media grid ---
  gridEl.innerHTML = "";
  const media = t.media || [];
  if (!media.length) {
    const nm = el("div", "no-media", "This post has no downloadable media — just the text.");
    gridEl.appendChild(nm);
  } else {
    media.forEach((m, i) => gridEl.appendChild(renderMediaCard(t, m, i)));
  }

  resultEl.hidden = false;
}

function fileChip(ext, m) {
  const chip = el("span", "chip");
  const fmt = el("span", "fmt", ext.toUpperCase());
  chip.appendChild(fmt);
  const bits = [];
  if (m.width && m.height) bits.push(`${m.width}×${m.height}`);
  if (m.type === "video" && m.duration_millis) bits.push(formatDuration(m.duration_millis));
  if (m.size) bits.push(formatBytes(m.size));
  let first = true;
  for (const b of bits) {
    if (!b) continue;
    if (!first) chip.appendChild(el("span", "sep", "·"));
    chip.appendChild(document.createTextNode(b));
    first = false;
  }
  return chip;
}

function renderMediaCard(t, m, index) {
  const card = el("div", "media-card");
  card.style.animation = reducedMotion ? "none" : `rise 0.32s ${0.05 * index}s cubic-bezier(0.2,0.7,0.3,1) both`;

  const prev = el("div", "media-prev");
  const filename = `${t.id}_${index + 1}.${m.ext || "bin"}`;

  if (m.type === "video") {
    const v = el("video");
    v.muted = true;
    v.playsInline = true;
    v.loop = true;
    v.preload = "metadata";
    // video.twimg.com rejects requests carrying a Referer header (which a
    // <video> element sends), so previews stream through our /api/media
    // proxy. The poster image (pbs.twimg.com) loads directly.
    if (m.thumbnail) v.poster = m.thumbnail;
    v.src = `/api/media?src=${encodeURIComponent(m.url)}&name=${encodeURIComponent(filename)}&inline=1`;
    if (!reducedMotion) {
      card.addEventListener("mouseenter", () => { v.play().catch(() => {}); });
      card.addEventListener("mouseleave", () => { v.pause(); });
    }
    prev.appendChild(v);
  } else {
    const img = el("img");
    img.loading = "lazy";
    img.alt = `Image ${index + 1}`;
    img.src = m.url;
    if (m.thumbnail) img.src = m.thumbnail || m.url;
    prev.appendChild(img);
  }
  prev.appendChild(fileChip(m.ext || "file", m));
  card.appendChild(prev);

  const foot = el("div", "media-foot");
  const name = el("span", "media-name", filename);
  name.title = filename;
  const actions = el("div", "media-actions");

  const dlBtn = el("button", "btn-ghost", "Download");
  dlBtn.type = "button";
  dlBtn.title = `Save as ${filename}`;
  const ico = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ico.setAttribute("class", "dl-ico");
  ico.setAttribute("viewBox", "0 0 24 24");
  ico.setAttribute("fill", "none");
  ico.setAttribute("stroke", "currentColor");
  ico.setAttribute("stroke-width", "2.2");
  ico.setAttribute("stroke-linecap", "round");
  ico.setAttribute("stroke-linejoin", "round");
  ico.innerHTML = '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>';
  dlBtn.appendChild(ico);
  dlBtn.appendChild(document.createTextNode(m.type === "video" ? ` ${m.ext.toUpperCase()}` : " " + (m.ext || "file").toUpperCase()));
  dlBtn.addEventListener("click", () => startFileDownload(m.url, filename));

  actions.appendChild(dlBtn);

  if (m.type === "video") {
    const mp3Btn = el("button", "btn-ghost mp3", "MP3");
    mp3Btn.type = "button";
    mp3Btn.title = "Extract the audio track and save it as MP3 (done in your browser)";
    mp3Btn.addEventListener("click", () => extractMp3(m, filename, mp3Btn));
    actions.appendChild(mp3Btn);
  }

  const orig = el("a", "open-orig", "↗");
  orig.href = m.url;
  orig.target = "_blank";
  orig.rel = "noopener";
  orig.title = "Open the original file in a new tab";
  actions.appendChild(orig);

  foot.appendChild(name);
  foot.appendChild(actions);
  card.appendChild(foot);

  // fetch the real file size for the chip (twimg exposes Content-Length)
  probeSize(m).then((size) => {
    if (size && size > 0) {
      m.size = size;
      const chip = card.querySelector(".chip");
      if (chip && !card._sizeDone) {
        card._sizeDone = true;
        const last = el("span", "sep", "·");
        const sz = el("span", null, formatBytes(size));
        chip.appendChild(last);
        chip.appendChild(sz);
      }
    }
  }).catch(() => {});

  return card;
}

async function probeSize(m) {
  try {
    // video.twimg.com 403s browser requests that carry a Referer header, so
    // videos are probed through our /api/media proxy (which answers HEAD).
    const url =
      m.type === "video"
        ? `/api/media?src=${encodeURIComponent(m.url)}&name=${encodeURIComponent("probe." + (m.ext || "mp4"))}`
        : m.url;
    const r = await fetch(url, { method: "HEAD" });
    if (!r.ok) return null;
    const len = r.headers.get("content-length");
    return len ? Number(len) : null;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

function startFileDownload(srcUrl, filename) {
  const target = `/api/media?src=${encodeURIComponent(srcUrl)}&name=${encodeURIComponent(filename)}`;
  const a = document.createElement("a");
  a.href = target;
  // same-origin: no download attr needed — the server sets Content-Disposition
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast(`Saving ${filename}`, "ok");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------------------------------------------------------------------------
// MP3 extraction (client-side: fetch video → decode audio → encode MP3)
// ---------------------------------------------------------------------------

const MAX_MP3_SOURCE_BYTES = 500 * 1024 * 1024; // 500 MB safety cap

async function extractMp3(m, baseName, btn) {
  if (btn.disabled) return;
  const originalLabel = btn.textContent;
  btn.disabled = true;
  try {
    // 1) fetch the video with progress — via our proxy, because
    //    video.twimg.com rejects browser fetches that carry a Referer.
    btn.textContent = "Fetching… 0%";
    const proxyUrl = `/api/media?src=${encodeURIComponent(m.url)}&name=${encodeURIComponent(baseName)}`;
    const buf = await fetchWithProgress(proxyUrl, (pct) => {
      btn.textContent = `Fetching… ${pct}%`;
    });

    // 2) decode audio
    btn.textContent = "Decoding…";
    await yieldToUI();
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    let audio;
    try {
      audio = await ctx.decodeAudioData(buf);
    } finally {
      ctx.close().catch(() => {});
    }
    if (!audio || audio.duration <= 0) {
      throw new Error("No audio track found in that video.");
    }

    // 3) downmix to stereo Int16
    const channels = Math.min(2, audio.numberOfChannels) || 1;
    const sr = audio.sampleRate;
    const len = audio.length;
    const L = audio.getChannelData(0);
    const R = channels === 2 ? audio.getChannelData(1) : L;
    const left = new Int16Array(len);
    const right = new Int16Array(len);
    for (let i = 0; i < len; i++) {
      let lv = Math.max(-1, Math.min(1, L[i]));
      let rv = Math.max(-1, Math.min(1, R[i]));
      left[i] = lv < 0 ? lv * 0x8000 : lv * 0x7fff;
      right[i] = rv < 0 ? rv * 0x8000 : rv * 0x7fff;
    }

    // 4) encode MP3 (128 kbps) in 1152-sample blocks
    const encoder = new lamejs.Mp3Encoder(channels, sr, 128);
    const BLOCK = 1152;
    const chunks = [];
    let encoded = 0;
    for (let i = 0; i < len; i += BLOCK) {
      const lb = left.subarray(i, i + BLOCK);
      const rb = right.subarray(i, i + BLOCK);
      const part = channels === 2 ? encoder.encodeBuffer(lb, rb) : encoder.encodeBuffer(lb);
      if (part.length) chunks.push(new Uint8Array(part));
      encoded += BLOCK;
      if ((i / BLOCK) % 200 === 0) {
        btn.textContent = `Encoding… ${Math.min(99, Math.round((encoded / len) * 100))}%`;
        await yieldToUI();
      }
    }
    const tail = encoder.flush();
    if (tail.length) chunks.push(new Uint8Array(tail));

    // 5) save
    const blob = new Blob(chunks, { type: "audio/mpeg" });
    const mp3Name = baseName.replace(/\.[a-z0-9]{2,5}$/i, "") + ".mp3";
    downloadBlob(blob, mp3Name);
    toast(`Saved ${mp3Name} (${formatBytes(blob.size)})`, "ok");
  } catch (e) {
    toast(e.message || "Couldn't extract audio from that video.", "err", 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

function fetchWithProgress(url, onProgress) {
  return new Promise(async (resolve, reject) => {
    try {
      const head = await fetch(url, { method: "HEAD" });
      if (head.ok) {
        const len = Number(head.headers.get("content-length") || 0);
        if (len > MAX_MP3_SOURCE_BYTES) {
          reject(new Error("That video is too large to convert in the browser (over 500 MB). Download the MP4 instead."));
          return;
        }
        const res = await fetch(url);
        if (!res.ok) throw new Error(`X's CDN answered ${res.status}.`);
        if (res.body && res.body.getReader) {
          const reader = res.body.getReader();
          const parts = [];
          let got = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            parts.push(value);
            got += value.length;
            if (len > 0) onProgress(Math.min(99, Math.round((got / len) * 100)));
          }
          const out = new Uint8Array(got);
          let off = 0;
          for (const p of parts) { out.set(p, off); off += p.length; }
          resolve(out.buffer);
          return;
        }
        const b = await res.arrayBuffer();
        if (b.byteLength > MAX_MP3_SOURCE_BYTES) {
          reject(new Error("That video is too large to convert in the browser (over 500 MB). Download the MP4 instead."));
          return;
        }
        onProgress(100);
        resolve(b);
        return;
      }
      // HEAD not honored — fall back to plain fetch
      const res2 = await fetch(url);
      if (!res2.ok) throw new Error(`X's CDN answered ${res2.status}.`);
      const b = await res2.arrayBuffer();
      if (b.byteLength > MAX_MP3_SOURCE_BYTES) {
        reject(new Error("That video is too large to convert in the browser (over 500 MB). Download the MP4 instead."));
        return;
      }
      onProgress(100);
      resolve(b);
    } catch (e) {
      reject(e);
    }
  });
}

function yieldToUI() {
  return new Promise((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------------

fetchBtn.addEventListener("click", () => {
  const v = inputEl.value.trim();
  if (!v) {
    inputEl.focus();
    return;
  }
  fetchTweet(v);
});

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    fetchBtn.click();
  }
});
