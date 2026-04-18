# 🎮 ROM Finder Bot

A production-ready Telegram bot that searches ROM files across multiple Telegram channels using fuzzy matching and user-feedback-driven ranking.

**Built with:** Node.js + TypeScript + Telegraf · **DB:** MongoDB Atlas (M0 free) · **Hosting:** Render (free tier)

**Made by:** [@PokemonBots](https://t.me/PokemonBots)  
**Source Code:** [github.com/aapokepikachu/rom-finder-bot](https://github.com/aapokepikachu/rom-finder-bot)

---

## 🤖 How the Bot Works (User Guide)

### Starting Out
Send `/start` for a welcome message, or `/help` for the full command list.

### Searching for a ROM
1. Send `/search`
2. A keyboard appears with **your admin's mapped categories** (e.g. "🎮 NDS Roms", "GBA Hacks") plus an **"I'm not sure (Search All)"** option
3. Pick a category — or choose Search All to scan every channel
4. Type the ROM name (partial names work: "pokemon" finds all Pokémon ROMs)
5. The bot returns:
   - **Best match** — file name, caption, size, download button
   - **Other matches** — list of similar results with links
6. After results, you'll see **"Did you find the ROM?"** — tap ✅ or ❌ to help the bot learn

### Other User Commands
| Command | Description |
|---------|-------------|
| `/top` | Top 5 most searched ROMs by all users |
| `/featured` | Up to 10 admin-curated ROMs |
| `/about` | Bot info, credits, source code link |
| `/ping` | Check bot response time |

---

## 🔍 Search Algorithm

1. **Normalize** the query — lowercase, trim, collapse whitespace
2. **Cache check** — if this exact query+category was searched recently, return instantly (< 5ms)
3. **Channel selection** — query the channel mapped to the chosen category, or all channels for "Search All"
4. **In-memory index** — messages are loaded from MongoDB into a per-channel Fuse.js index (TTL 30 min). No live API call on every search.
5. **Fuzzy match** — Fuse.js scores each message:
   - File name: weight **0.65**
   - Caption text: weight **0.35**
   - Threshold: 0.55 (lenient — catches typos, partial names)
6. **Feedback boost** — results confirmed by past users get a score boost (up to +15%); results users rejected get a small penalty (−10%)
7. **Re-rank** — results are sorted by final boosted score, best first
8. **Cache write** — result stored in LRU cache (max 200 entries, 1-hour TTL)
9. **Record search** — query saved to DB for `/top` command

---

## 📁 Project Structure

```
rom-finder-bot/
├── src/
│   ├── index.ts                    # Bot entry point — registers all handlers, launches
│   ├── config/
│   │   └── index.ts                # Zod env validation, exports `config`
│   ├── models/
│   │   ├── User.ts                 # User tracking (blocked/deleted/active)
│   │   ├── Channel.ts              # Channel → label mappings
│   │   ├── ChannelMessage.ts       # Indexed ROM files (the search corpus)
│   │   ├── Search.ts               # Search frequency for /top
│   │   ├── Featured.ts             # Admin-curated featured list
│   │   ├── Setting.ts              # Bot settings (request URL, etc.)
│   │   └── SearchFeedback.ts       # ✅/❌ votes for smart ranking
│   ├── services/
│   │   ├── database.ts             # MongoDB connection + countDocuments stats
│   │   ├── search.ts               # Core search engine (Fuse.js + feedback boost)
│   │   ├── cache.ts                # In-memory LRU cache
│   │   └── session.ts              # Per-user conversation state (in-memory)
│   ├── commands/
│   │   ├── basic.ts                # /start /help /about /ping
│   │   ├── discovery.ts            # /top /featured
│   │   ├── search.ts               # /search + result rendering
│   │   ├── admin.ts                # /set /db /users /helpa — HTML messages
│   │   ├── broadcast.ts            # /broadcast
│   │   └── backfill.ts             # /backfill — index historical channel files
│   ├── handlers/
│   │   ├── channel.ts              # Indexes incoming channel posts live
│   │   ├── callbacks.ts            # All inline keyboard button handlers
│   │   └── text.ts                 # Multi-step conversation flow handler
│   ├── middleware/
│   │   ├── admin.ts                # Admin-only guard
│   │   ├── userTracker.ts          # Upserts user record on every message
│   │   ├── rateLimiter.ts          # 15 req/min per user (admins exempt)
│   │   └── errorHandler.ts         # Global Telegraf error handler
│   └── utils/
│       ├── logger.ts               # Winston logger
│       ├── helpers.ts              # normalizeQuery, buildMessageLink, escaping, etc.
│       ├── keyboards.ts            # All InlineKeyboardMarkup builders
│       └── health.ts               # HTTP /health endpoint for Render
├── .env.example                    # Copy to .env and fill in
├── render.yaml                     # Render deployment config
├── tsconfig.json
└── package.json
```

---

## 🗄️ MongoDB Schema

All collections use `countDocuments()` for stats — `db.stats()` is **not** used (unsupported on Atlas M0 free tier).

### `channelmessages` — The search corpus
| Field | Type | Notes |
|-------|------|-------|
| channelId | String | Source channel ID |
| messageId | Number | Telegram message ID |
| fileName | String | ROM file name (text-indexed) |
| caption | String | Full caption (text-indexed) |
| category | String | Channel label from mapping |
| fileSize | Number | Bytes |
| fileId | String | Telegram file_id |

Index: `(channelId, messageId)` unique · `fileName + caption` text

### `channels` — Admin-defined mappings
| Field | Type | Notes |
|-------|------|-------|
| channelId | String | Unique |
| label | String | Button text shown in /search |
| category | String | = channelId (internal key) |
| mappedBy | Number | Admin user ID |

### `searchfeedbacks` — Smart ranking data
| Field | Type | Notes |
|-------|------|-------|
| normalizedQuery | String | Lowercased query |
| channelId + messageId | String/Number | Which result |
| gotIt | Boolean | true = confirmed, false = rejected |
| userId | Number | One vote per user per result |

### `searches` — For /top command
| Field | Type | Notes |
|-------|------|-------|
| normalizedQuery | String | Unique |
| count | Number | Indexed descending |
| query | String | Original casing |

### `featureds`, `users`, `settings`
Standard schemas — see `src/models/` for full definitions.

---

## ⚙️ Setup & Local Development

### Prerequisites
- Node.js 18+
- MongoDB Atlas account (free M0 cluster)
- Telegram bot token from [@BotFather](https://t.me/BotFather)

### 1 — Install
```bash
git clone https://github.com/aapokepikachu/rom-finder-bot
cd rom-finder-bot
npm install
```

### 2 — Configure
```bash
cp .env.example .env
```

Edit `.env`:
```env
BOT_TOKEN=1234567890:ABCdef...
ADMIN_IDS=123456789
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/romfinder
CHANNELS=-1001234567890,-1009876543210
OWNER_NAME=Your Name
OWNER_HANDLE=yourtelegramusername     # NO @ symbol
SOURCE_CODE_URL=https://github.com/yourusername/rom-finder-bot
```

### 3 — Run locally
```bash
npm run dev     # hot-reload dev mode
npm run build   # compile TypeScript
npm start       # run compiled output
```

---

## 📡 Channel Setup

### ⚠️ Important: File Indexing
> The bot can **only index files that are posted after it is added as admin** to a channel. Files uploaded before the bot was added will NOT be found by /search.
>
> **To index existing files:** Use `/backfill` (see below).

### Steps
1. **Add the bot as admin** to each channel with "Post Messages" permission
2. Add channel IDs to the `CHANNELS` env var (comma-separated, each starts with `-100`)
3. **Map each channel** via `/set` → "Map Channels to Categories":
   - Tap a channel button
   - Type a short label (e.g. `🎮 NDS Roms`, `GBA Hacks`)
   - That label becomes a button in /search
4. **Backfill old files** with `/backfill` → select the channel

### Getting a Channel ID
Forward any message from the channel to [@userinfobot](https://t.me/userinfobot). Channel IDs always start with `-100`.

---

## 🔄 Backfill (Indexing Old Files)

`/backfill` scans a channel's message history and indexes all file messages it finds.

**How it works:**
- Iterates message IDs from the last indexed ID (or 1 if fresh)
- Calls `forwardMessage` for each ID — the only Bot API method that returns full file metadata for channel posts
- Forwards appear briefly in your private chat then are deleted automatically
- Stops after 50 consecutive missing IDs (handles deleted message gaps)
- Respects Telegram rate limits (380ms between requests, auto-waits on flood errors)
- Safe to re-run — resumes from last indexed ID

**Requirements:** Bot must be admin in the channel with at least "Forward Messages" permission.

---

## 🚀 Deploy to Render

### Step 1 — Push to GitHub
```bash
git init && git add . && git commit -m "init"
git remote add origin https://github.com/yourname/rom-finder-bot
git push -u origin main
```

### Step 2 — Create Web Service on Render
1. [render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub repo
3. Render detects `render.yaml` automatically:
   - Build: `npm install && npm run build`
   - Start: `npm start`
   - Plan: Free

### Step 3 — Set Environment Variables
In Render dashboard → Environment:

| Key | Value |
|-----|-------|
| `BOT_TOKEN` | Your bot token |
| `MONGODB_URI` | Atlas connection string |
| `ADMIN_IDS` | `123456789` |
| `CHANNELS` | `-1001234567890,-1009876543210` |
| `OWNER_NAME` | `Your Name` |
| `OWNER_HANDLE` | `yourusername` (no @) |
| `SOURCE_CODE_URL` | Your GitHub URL |

> Render automatically sets `PORT` and `RENDER_EXTERNAL_URL` — the bot uses these for webhook mode.

### Step 4 — Keep Alive (Free Tier)
Render free tier sleeps after 15 minutes of no HTTP traffic. Set up a free pinger:
- [UptimeRobot](https://uptimerobot.com) — ping `https://your-app.onrender.com/health` every 5 minutes
- [cron-job.org](https://cron-job.org) — same URL, free

### Step 5 — First Run Checklist
```
✅ Bot deployed and running
✅ /backfill run for each channel (indexes old files)
✅ /set → Map Channels → label each channel
✅ /set → Set Request-It URL (optional)
✅ /featured → set some featured ROMs (optional)
✅ /search → verify category buttons appear and results return
```

---

## 🔒 Security & Rate Limiting

### Rate Limiter
Built-in per-user sliding window: **15 requests per 60 seconds**.

Why it's needed:
- Prevents a single user from flooding `/search` and hammering the DB + Fuse.js index
- Protects Telegram's bot API quota (30 msg/sec global limit)
- Keeps Render free-tier CPU within limits
- Stops scripted abuse

**Admins are fully exempt** — they need to run `/backfill`, `/broadcast`, etc. without throttling.

Exceeded users get a friendly message once, then subsequent requests are silently dropped until the window resets.

### Other Security
- Admin commands protected by `ADMIN_IDS` env check — no roles in DB
- All inline button actions re-verify admin status
- Input length validated (search queries: 2–100 chars, labels: 1–50 chars)
- No user data leaked cross-user
- Destructive DB operations require confirmation button
- Bot token never logged

---

## 👮 Admin Guide

### Map a Channel
1. `/set` → **Map Channels to Categories**
2. Tap a channel ID button
3. Type a short label: `🎮 NDS Roms`
4. Confirm if replacing an existing mapping
5. The label immediately appears as a button in /search

### Set Featured ROMs (up to 10)
1. `/set` → **Set Featured ROMs**
2. Tap a position (#1–#10)
3. **Forward** a file message from a ROM channel to the bot — OR send: `Title | -100xxxxxxxxxx | messageId`

### Set Request-It URL
1. `/set` → **Set Request-It URL**
2. Send a URL (Google Form, group link, etc.)
3. Appears as a button when no search results are found

### Broadcast
1. `/broadcast` → type your message (Markdown supported)
2. Preview appears — confirm or cancel
3. Sent to all active users (skips blocked/deleted), reports delivery stats

### Maintenance Mode (`/maintenance`)
Toggles a global maintenance lock:
- **ON** → all user commands are blocked with a friendly notice; /search, /top, /featured, etc. all show "under maintenance"
- **OFF** → bot is fully live again
- Admins are **never** blocked regardless of maintenance state
- Channel posts (live indexing) pass through so /backfill continues to work
- State survives restarts (stored in MongoDB)

**Typical workflow:**
```
/maintenance → Turn ON
/backfill → run full channel scan
/maintenance → Turn OFF
```

### Unindex Manager (`/unindex`)
Three tools for keeping unwanted files out of search results:

**1. Block a Tag** (`🏷️ Block a Tag`)
- Add a hashtag like `#misc` or `#skip` to a file's caption in the channel
- Then block that tag in `/unindex` → any file with that tag in its caption is:
  - Removed from the index immediately
  - Skipped during future /backfill runs
  - Skipped on live new posts
- You can view and remove blocked tags from the same menu

**2. Unindex a Specific File** (`📩 Unindex a Specific File`)
- Forward the exact file message from the ROM channel to the bot
- That single file is deleted from the index
- Will not reappear in search results
- To make the exclusion permanent across resets, also add a blocking tag to its caption

**3. View & Remove Blocked Tags** (`📋 View & Remove Blocked Tags`)
- Lists all currently blocked tags
- Tap any tag to unblock it

### Database Tools (`/db`)
| Action | Description |
|--------|-------------|
| View Usage Stats | Document counts per collection + estimated storage vs 512MB limit |
| Clear Search Cache | Invalidates in-memory cache (useful after bulk uploads) |
| Clear Message Index | Forces Fuse.js index rebuild on next search |
| Delete All Data | Nuclear option — requires confirmation |

---

## 📊 Performance Notes

| Metric | Value |
|--------|-------|
| Search latency (cache hit) | < 5ms |
| Search latency (cache miss) | 50–300ms |
| In-memory index TTL | 30 minutes |
| Cache size | Max 200 entries (LRU eviction) |
| Rate limit | 15 req/min per user |
| Backfill speed | ~2.6 messages/sec |
| Broadcast delay | 35ms between sends |
| MongoDB plan | Atlas M0 (512MB) |

---

## 🛠️ Troubleshooting

**Map Channels button doesn't respond?**
Make sure channels are set in the `CHANNELS` env var and the service is redeployed.

**Search returns no results?**
Files must be posted *after* the bot is admin, OR run `/backfill` to index old files.

**Backfill fails with "Forbidden"?**
The bot needs admin rights in the channel. Add it as admin first.

**MongoDB connection fails?**
In Atlas → Network Access → add `0.0.0.0/0` (allow all IPs) for Render's dynamic IPs.

**Stats show "Stats error"?**
Old versions used `db.stats()` which is unsupported on Atlas M0. v5+ uses `countDocuments()` only.

**Bot sleeping on Render?**
Set up UptimeRobot to ping `/health` every 5 minutes.

---

## 📄 License

MIT — free to use, fork, and deploy.
