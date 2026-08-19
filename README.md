# X Media Grab

Paste a post link (or post ID) from **X / Twitter** and download its media
straight to your device:

| Media   | What you get                                   |
| ------- | ---------------------------------------------- |
| Images  | Original-resolution file (`JPG` / `PNG` / `GIF`) |
| Videos  | Highest-quality `MP4` from the post            |
| Audio   | `MP3` — the audio track extracted from a video, encoded **in your browser** |

Built as a static frontend + two **zero-dependency** Netlify functions.
No API keys, no databases, no build step.

---

## How it works

```
browser ──GET /api/tweet?input=<url-or-id>──▶  Netlify function
                                                  │ 1. parse post ID (bare ID,
                                                  │    /status/<id>/ URL, t.co
                                                  │    redirect resolution)
                                                  │ 2. X syndication endpoint
                                                  │    (the same one embeds use)
                                                  │ 3. fallback: api.fxtwitter.com
                                                  ▼
browser ◀── normalized JSON ─────────────────────  (author, text, media list)

browser ──GET /api/media?src=<twimg url>&name=…──▶  Netlify function
                                                  │ streams the file back with
                                                  │ Content-Disposition: attachment
browser ◀── file download (JPG / MP4) ────────────
```

- **MP3** never touches the server: the browser fetches the MP4 from X's CDN
  (it serves `Access-Control-Allow-Origin: *`), decodes the audio track with
  the Web Audio API, and encodes MP3 with the vendored `lamejs` encoder.
- The `/api/media` proxy only accepts URLs on X's own CDNs
  (`pbs.twimg.com`, `video.twimg.com`, `abs.twimg.com`) — it is a media
  downloader, not an open proxy.
- Every media card also has an **↗ Open original** link to the direct CDN URL,
  which always works even if the function is busy or the file is huge.

## Project layout

```
x-media-downloader/
├── netlify.toml          # publish=public, functions=functions, Node 18
├── package.json          # dev-only (netlify CLI for local dev)
├── public/               # static site (the "site" of the Netlify app)
│   ├── index.html
│   ├── css/styles.css
│   ├── js/app.js
│   └── vendor/lame.min.js  # vendored MP3 encoder (lamejs 1.2.1)
└── functions/            # Netlify serverless functions
    ├── tweet.js          # /api/tweet  — resolve post → media metadata
    └── media.js          # /api/media  — stream CDN file as attachment
```

## Deploy to Netlify

### Option A — drag & drop (no account tooling needed)

1. Go to <https://app.netlify.com/drop>.
2. Drag this folder (`x-media-downloader/`) onto the page.
   `netlify.toml` is picked up automatically (publish `public/`,
   functions `functions/`, Node 18).
3. Done — your site is live at `https://<random>.netlify.app`.

### Option B — Git + Netlify

1. Push this folder to a GitHub repo.
2. Netlify → **Add new site → Import an existing project** → pick the repo.
3. Build settings are read from `netlify.toml` automatically
   (no build command; publish directory `public/`).
4. Deploy.

### Option C — CLI

```bash
cd x-media-downloader
npm install          # installs the netlify CLI (dev dependency)
npx netlify login
npx netlify deploy --prod
```

## Run locally

```bash
cd x-media-downloader
npm install
npm run dev          # netlify dev → http://localhost:8888
```

(`netlify dev` serves `public/` **and** the functions, so the whole app
works exactly like production. The static files alone can be opened with any
static server, but the `/api/*` endpoints will 404 without `netlify dev` or a
real deploy.)

## Notes & limitations

- **No API key.** The lookup uses X's public syndication endpoint (the same
  one `twitter.com/widgets` embeds use) with the standard token formula, and
  falls back to the public fxtwitter API. Both can rate-limit under heavy use
  — the UI tells you when to wait.
- **Availability.** Private accounts, deleted posts, age-restricted posts,
  and some very old posts may not resolve through the public endpoints.
- **Big videos on the free plan.** Netlify's free-tier functions have a short
  invocation timeout; very large MP4s streamed through `/api/media` could be
  cut off. The **↗ Open original** link bypasses the function entirely and
  always works.
- **MP3 extraction limits.** Browser audio decoding of MP4/AAC works in
  current Chrome, Edge, Firefox, and Safari. Files over ~500 MB are refused
  (memory), and a video with no audio track simply has nothing to extract.
- **Fair use.** This is a personal-use tool. Only save media you have the
  right to keep — X's Terms of Service and copyright still apply.
# Deploying fix

