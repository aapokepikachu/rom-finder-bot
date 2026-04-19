# 🎮 ROM Finder Bot

A production-ready Telegram bot that searches ROM files across multiple channels using fuzzy matching and user-feedback-driven ranking. Fully modular — swap "ROM" for any file type and it works as a general-purpose file-search bot.

**Stack:** Node.js · TypeScript · Telegraf · MongoDB Atlas M0 · Render (free tier)  
**Version:** 1.0.1  
**Made by:** [@PokemonBots](https://t.me/PokemonBots)  
**Source:** [github.com/aapokepikachu/rom-finder-bot](https://github.com/aapokepikachu/rom-finder-bot)

---

## 🤖 How the Bot Works (User Guide)

### Searching for a ROM

1. Send `/search`
2. A keyboard appears with your admin's mapped categories. There are two types:
   - **Channel categories** — searches files from a specific channel
   - **Tag categories** — searches files from *any* channel whose caption contains a specific hashtag (e.g. `#emulator`)
   - **"I'm not sure (Search All)"** — scans everything
3. Type the ROM name. Partial names work — `"pokemon"` finds all Pokémon ROMs
4. The bot returns the **best match** (file name, caption, size, download link) plus **other matches**
5. Tap **✅ Yes, got it!** or **❌ No, not what I need** — your feedback improves future results for everyone

### Other User Commands

| Command | Description |
|---------|-------------|
| `/top` | Top 5 most searched ROMs across all users |
| `/featured` | Up to 10 admin-curated ROMs |
| `/about` | Version, credits, source code button |
| `/ping` | Check bot response latency |
| `/help` | Full command guide |

---

## 🔍 Search Algorithm

1. **Normalize** — lowercase, trim, collapse whitespace
2. **Cache check** — exact query + category scope cached in memory (< 5 ms hit)
3. **Scope resolution:**
   - *Channel category* → load only that channel's messages
   - *Tag category* → load all channels, filter messages whose caption contains the tag
   - *Search All* → load all channels unfiltered
4. **Fuse.js fuzzy match** on the candidate set:
   - `fileName` weight **0.65** · `caption` weight **0.35**
   - Threshold 0.55 — tolerates typos and partial titles
5. **Feedback boost** — results confirmed by past users score up to +15%; rejected results score −10%
6. **Re-rank** by final boosted score, best first
7. **Cache write** — LRU cache, max 200 entries, 1-hour TTL
8. **Record search** — stored for `/top` command

---

## 📁 Project Structure

```
rom-finder-bot/
├── src/
│   ├── index.ts                     # Entry point — registers all handlers, launches bot
│   ├── config/
│   │   └── index.ts                 # Zod env validation, exports config object
│   ├── models/
│   │   ├── User.ts                  # User records (blocked/deleted tracking)
│   │   ├── Channel.ts               # Channel → label mappings (channel categories)
│   │   ├── TagCategory.ts           # Tag → label mappings (tag-based categories)
│   │   ├── ChannelMessage.ts        # Indexed ROM files — the search corpus
│   │   ├── Search.ts                # Search frequency tracking for /top
│   │   ├── Featured.ts              # Admin-curated featured list (up to 10)
│   │   ├── Setting.ts               # Bot settings (request URL, maintenance, blocked tags)
│   │   └── SearchFeedback.ts        # ✅/❌ votes used for smart re-ranking
│   ├── services/
│   │   ├── database.ts              # MongoDB connection, countDocuments-based stats
│   │   ├── search.ts                # Core search engine (Fuse.js + tag filter + feedback)
│   │   ├── cache.ts                 # In-memory LRU cache
│   │   └── session.ts               # Per-user multi-step conversation state
│   ├── commands/
│   │   ├── basic.ts                 # /start /help /about /ping
│   │   ├── discovery.ts             # /top /featured
│   │   ├── search.ts                # /search — guided flow + result rendering
│   │   ├── admin.ts                 # /set /db /users /helpa
│   │   ├── broadcast.ts             # /broadcast — 4-step compose/format/preview/send
│   │   ├── backfill.ts              # /backfill — index historical channel messages
│   │   ├── maintenance.ts           # /maintenance — toggle user access lock
│   │   └── unindex.ts               # /unindex — remove files by tag or forward
│   ├── handlers/
│   │   ├── channel.ts               # Live-indexes incoming channel posts (respects blocked tags)
│   │   ├── callbacks.ts             # All inline keyboard button handlers
│   │   └── text.ts                  # Multi-step text flow (search, mapping, broadcast, tags)
│   ├── middleware/
│   │   ├── admin.ts                 # Admin-only guard
│   │   ├── userTracker.ts           # Upserts user record on every message
│   │   ├── rateLimiter.ts           # 15 req/min per user (admins exempt)
│   │   ├── maintenance.ts           # Blocks all users when maintenance is ON
│   │   └── errorHandler.ts          # Global Telegraf error handler
│   └── utils/
│       ├── logger.ts                # Winston logger
│       ├── helpers.ts               # normalizeQuery, buildMessageLink, formatFileSize, etc.
│       ├── keyboards.ts             # All InlineKeyboardMarkup builders
│       ├── blockedTags.ts           # Cached blocked-tag checker (30s TTL)
│       └── health.ts                # HTTP /health endpoint for Render keep-alive
├── .env.example
├── render.yaml
├── tsconfig.json
└── package.json
```

---

## 🗄️ MongoDB Schema

> Atlas M0 does **not** support `db.stats()`. All stats use `countDocuments()`.

### `channelmessages` — search corpus
| Field | Type | Notes |
|-------|------|-------|
| channelId | String | Source channel |
| messageId | Number | Telegram message ID |
| fileName | String | File name (fuzzy-searched) |
| caption | String | Caption text (fuzzy-searched) |
| category | String | Channel label from mapping |
| fileSize | Number | Bytes |
| fileId | String | Telegram file_id |

Index: `(channelId, messageId)` unique · `fileName + caption` text

### `channels` — channel-based categories
| Field | Type | Notes |
|-------|------|-------|
| channelId | String | Unique |
| label | String | Button text in /search |
| mappedBy | Number | Admin user ID |

### `tagcategories` — tag-based categories
| Field | Type | Notes |
|-------|------|-------|
| tag | String | e.g. `#emulator` — unique |
| label | String | Button text in /search |
| addedBy | Number | Admin user ID |

### `searchfeedbacks` — smart ranking data
| Field | Type | Notes |
|-------|------|-------|
| normalizedQuery | String | Lowercased query |
| channelId + messageId | — | Identifies the result |
| gotIt | Boolean | true = confirmed, false = rejected |
| userId | Number | One vote per user per result per query |

### `searches` — `/top` command data
| Field | Type | Notes |
|-------|------|-------|
| normalizedQuery | String | Unique |
| count | Number | Descending index for fast /top queries |

---

## ⚙️ Setup & Local Development

### Prerequisites
- Node.js 18+
- MongoDB Atlas free M0 cluster
- Telegram bot token from [@BotFather](https://t.me/BotFather)

### Install
```bash
git clone https://github.com/aapokepikachu/rom-finder-bot
cd rom-finder-bot
npm install
cp .env.example .env
```

### Configure `.env`
```env
BOT_TOKEN=1234567890:ABCdef...
ADMIN_IDS=123456789
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/romfinder
CHANNELS=-1001234567890,-1009876543210
OWNER_NAME=Your Name
OWNER_HANDLE=yourtelegramusername    # NO @ symbol
SOURCE_CODE_URL=https://github.com/yourusername/rom-finder-bot
```

### Run
```bash
npm run dev     # hot-reload development
npm run build   # compile TypeScript
npm start       # run compiled output
```

---

## 📡 Channel Setup

> **Important:** The bot can only index files posted **after** it is added as admin.  
> For existing files use `/backfill`. See the Backfill section below.

1. Add the bot as **admin** with "Post Messages" permission in each channel
2. Add channel IDs (comma-separated) to `CHANNELS` in your environment
3. Map each channel via `/set` → **Map Channels to Categories** → tap a channel → type its label
4. Run `/backfill` to index all historical files

**Getting a channel ID:** Forward any message from the channel to [@userinfobot](https://t.me/userinfobot). Channel IDs always start with `-100`.

---

## 🏷️ Tag Categories

Tag categories let you create a /search button that **filters by hashtag across all channels** — not tied to any single channel.

**Example use case:** You have files with `#emulator` in their captions scattered across multiple channels. Create a tag category `#emulator` → `🕹️ Emulators` and users get a dedicated search button that only shows emulator files.

**How to create one:**
1. `/set` → **Map Channels to Categories**
2. Tap **🏷️ Set Tag Category** (top button)
3. Send the tag: `#emulator`
4. Send the label: `🕹️ Emulators`

**How it works in search:**
- User taps "🕹️ Emulators"
- Bot loads all indexed messages from all channels
- Filters to only those whose caption contains `#emulator`
- Runs fuzzy search on that filtered set

**Managing tag categories:** `/set` → **Map Channels** → **📋 Manage Tag Categories** → tap any to remove.

---

## 🔄 Backfill

`/backfill` scans a channel's full message history and indexes all file messages found.

**Why it's needed:** The Telegram Bot API has no history endpoint for bots. Files uploaded before the bot was added as admin are invisible. Backfill works by iterating message IDs sequentially and using `forwardMessage` (the only Bot API method that returns full file metadata for channel posts).

**How to run:**
1. `/maintenance` → Turn ON (prevents users from getting partial results while indexing)
2. `/backfill` → select a channel (or "All Channels")
3. Wait — progress updates every 50 messages
4. `/maintenance` → Turn OFF

**Details:**
- Resumes from the last indexed ID — safe to re-run after interruption
- Stops after 50 consecutive missing IDs (handles deleted message gaps)
- Respects Telegram rate limits: 380ms between requests, auto-waits on flood errors
- Forwarded messages appear briefly in your private chat then are auto-deleted

---

## 🚀 Deploy to Render

### 1 — Push to GitHub
```bash
git init && git add . && git commit -m "init"
git remote add origin https://github.com/yourname/rom-finder-bot
git push -u origin main
```

### 2 — Create Web Service
1. [render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub repo
3. Render auto-detects `render.yaml` — confirm:
   - Build: `npm install && npm run build`
   - Start: `npm start`
   - Plan: Free

### 3 — Environment Variables

| Key | Value |
|-----|-------|
| `BOT_TOKEN` | Your Telegram bot token |
| `MONGODB_URI` | Atlas connection string |
| `ADMIN_IDS` | `123456789` (comma-separated for multiple) |
| `CHANNELS` | `-1001234567890,-1009876543210` |
| `OWNER_NAME` | Your display name |
| `OWNER_HANDLE` | Your Telegram username (no @) |
| `SOURCE_CODE_URL` | Your GitHub repo URL |

> Render auto-sets `PORT` and `RENDER_EXTERNAL_URL`. The bot uses these for webhook mode automatically.

### 4 — Keep Alive (Free Tier)
Render sleeps after 15 min of no HTTP traffic. Set up a free pinger:
- [UptimeRobot](https://uptimerobot.com) — ping `https://your-app.onrender.com/health` every 5 min

### 5 — First Run Checklist
```
✅ Bot deployed and /ping responds
✅ /maintenance → Turn ON
✅ /backfill → run for each channel
✅ /maintenance → Turn OFF
✅ /set → Map Channels → label each channel
✅ /set → Set Tag Categories (optional)
✅ /set → Set Request-It URL (optional)
✅ /search → verify category buttons and results work
```

---

## 🔒 Security & Rate Limiting

### Rate Limiter
15 requests per 60 seconds per user. Admins are fully exempt.

Protects against:
- Search flooding that hammers the DB + Fuse.js index
- Telegram API quota abuse (30 msg/sec global limit)
- Render free-tier CPU spikes

Exceeded users receive one friendly warning, then requests are silently dropped until the window resets.

### Admin Security
- All admin commands verify `ADMIN_IDS` on every call — no DB roles
- Inline button callbacks re-verify admin status independently
- Destructive operations require confirmation button
- Bot token never appears in logs

---

## 👮 Admin Command Reference

### `/set` — Settings Menu
- **Map Channels to Categories** — label each channel; also access tag category tools here
- **Set Featured ROMs** — pick positions 1–10, forward a file or send `Title | channelId | msgId`
- **Set Request-It URL** — shown when no results are found

### `/db` — Database Tools
| Action | What it does |
|--------|-------------|
| View Usage Stats | Document counts + estimated storage vs 512MB limit |
| Clear Search Cache | Invalidates in-memory query cache |
| Clear Message Index | Forces Fuse.js index rebuild on next search |
| Delete All Data | Wipes everything — requires confirmation |

### `/broadcast` — Message All Users
4-step flow: compose → pick format (Plain/HTML/Markdown) → validate against Telegram → preview → confirm. Validation sends a silent test message to the admin first — formatting errors are caught before broadcast.

### `/backfill` — Index Historical Files
Select a channel (or all). Scans all message IDs, indexes files, respects rate limits.

### `/maintenance` — Toggle Maintenance Mode
- **ON**: all user commands blocked with "under maintenance" notice; admins unaffected; channel indexing continues
- **OFF**: bot fully live again
- State persists across restarts (stored in MongoDB)

### `/unindex` — Remove Files from Index
- **Block a Tag** — files with this tag in their caption are deleted from index and skipped going forward
- **Unindex a Specific File** — forward the file from a ROM channel to remove it
- **View & Remove Blocked Tags** — manage the blocked tag list

### `/users` — User Statistics
Total, active, active today, blocked, deleted.

### `/helpa` — Admin Help
Full admin command reference in-chat.

---

## 📊 Performance Reference

| Metric | Value |
|--------|-------|
| Cache hit latency | < 5 ms |
| Cache miss latency | 50–300 ms |
| In-memory index TTL | 30 minutes |
| Cache max size | 200 entries (LRU) |
| Rate limit | 15 req/min per user |
| Backfill speed | ~2.6 messages/sec |
| Broadcast delay | 35 ms between sends |
| Maintenance cache TTL | 10 seconds |
| Blocked tags cache TTL | 30 seconds |
| MongoDB plan | Atlas M0 (512 MB) |

---

## 🛠️ Troubleshooting

| Problem | Fix |
|---------|-----|
| Map Channels button doesn't respond | Check `CHANNELS` env var is set and redeploy |
| Search returns no results | Run `/backfill` — files uploaded before the bot was admin aren't indexed |
| Backfill fails with "Forbidden" | Bot needs admin rights in the channel with "Forward Messages" permission |
| `/db` stats error | Old versions used `db.stats()` (unsupported on Atlas M0). v1.0.1+ uses `countDocuments()` |
| MongoDB connection fails | Atlas → Network Access → add `0.0.0.0/0` for Render's dynamic IPs |
| Bot sleeping on Render | Set up UptimeRobot to ping `/health` every 5 min |
| Broadcast crashes on `_` in text | Use HTML mode for messages with underscores, or escape as `\_` in Markdown mode |

---

## ♻️ Adapting for Other File Types

This bot works for any type of file search, not just ROMs. To adapt:

1. Fork the repo
2. Replace all instances of `"ROM"` with your file type (e.g. `"Book"`, `"Mod"`, `"Sample"`)
3. Update channel categories and tag categories to match your content
4. Deploy as-is — the search, indexing, feedback, and admin tools all work the same way

---

## 📄 License

MIT — free to use, fork, and deploy.
