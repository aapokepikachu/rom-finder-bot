# 🎮 ROM Finder Bot

A production-ready Telegram bot that searches ROM files across multiple channels using fuzzy matching and user-feedback-driven ranking. Fully modular — swap "ROM" for any file type and it works as a general-purpose file-search bot.

**Stack:** Node.js · TypeScript · Telegraf · MongoDB Atlas M0 · Render (free tier)  
**Version:** 1.2.0  
**Made by:** [@PokemonBots](https://t.me/PokemonBots)

---

## 🤖 User Guide

### Searching for a ROM

1. Send `/search`
2. Pick a category from the keyboard, or tap **Search All**:
   - **Channel categories** — files from a specific channel
   - **Tag categories** — files from *any* channel whose caption contains a hashtag (e.g. `#emulator`)
3. Type the ROM name — partial names and typos work
4. The bot returns the **best match** plus **other results**
5. Tap **✅ Yes** or **❌ No** — your feedback improves results for everyone

> **Tip:** Be specific. `Pokemon Fire Red GBA` beats `Pokemon`. The more detail you include, the better the match.

### User Commands

| Command | Description |
|---------|-------------|
| `/search` | Guided ROM search with category buttons |
| `/random` | Get a surprise random ROM from the index |
| `/top` | Top 5 most searched ROMs |
| `/featured` | Admin-curated ROM picks |
| `/about` | Version, credits, source code |
| `/ping` | Check bot response latency |
| `/help` | Full command guide |

---

## 🔍 Search Algorithm

1. **Normalise** — lowercase, trim, collapse whitespace
2. **Cache check** — exact query + category scope served from memory (< 5 ms hit)
3. **Scope resolution:**
   - *Channel category* → load only that channel's indexed messages
   - *Tag category* → load all channels, filter by caption hashtag
   - *Search All* → full unfiltered index
4. **Fuse.js fuzzy match** on the candidate set:
   - `fileName` weight **0.65** · `caption` weight **0.35**
   - Threshold 0.55 — tolerates typos and partial titles
5. **Feedback boost** — confirmed results score up to +15%; rejected results score −10%
6. **Re-rank** by final boosted score, best first
7. **Cache write** — LRU, max 200 entries, 1-hour TTL
8. **Record search** — stored for `/top`

---

## 📁 Project Structure

```
rom-finder-bot/
├── src/
│   ├── index.ts                     # Entry point — registers all handlers, launches bot
│   ├── config/
│   │   └── index.ts                 # Zod env validation
│   ├── models/
│   │   ├── User.ts
│   │   ├── Channel.ts               # Channel → label mappings
│   │   ├── TagCategory.ts           # Tag → label mappings
│   │   ├── ChannelMessage.ts        # Indexed ROM files (search corpus)
│   │   ├── Search.ts                # Search frequency for /top
│   │   ├── Featured.ts              # Admin-curated list (up to 10)
│   │   ├── Setting.ts               # Settings (request URL, maintenance, blocked/excluded tags)
│   │   └── SearchFeedback.ts        # ✅/❌ votes for feedback ranking
│   ├── services/
│   │   ├── database.ts              # MongoDB connection, countDocuments-based stats
│   │   ├── search.ts                # Fuse.js + tag filter + feedback boost
│   │   ├── cache.ts                 # In-memory LRU cache
│   │   └── session.ts               # Per-user conversation state (in-memory, 10-min TTL)
│   ├── commands/
│   │   ├── basic.ts                 # /start /help /about /ping
│   │   ├── discovery.ts             # /top /featured
│   │   ├── search.ts                # /search — guided flow, result rendering, vague-query guard
│   │   ├── admin.ts                 # /set /db /users /helpa /set_search_hint
│   │   ├── broadcast.ts             # /broadcast — 4-step compose/format/preview/send
│   │   ├── backfill.ts              # /backfill — index historical channel messages
│   │   ├── maintenance.ts           # /maintenance — toggle user access lock
│   │   ├── unindex.ts               # /unindex — remove files by tag or forward
│   │   ├── random.ts                # /random — serve a random indexed ROM
│   │   └── random_edit.ts           # /random_edit — manage /random exclusions
│   ├── handlers/
│   │   ├── channel.ts               # Live-indexes incoming channel posts
│   │   ├── callbacks.ts             # All inline keyboard button handlers
│   │   └── text.ts                  # Multi-step text flows
│   ├── middleware/
│   │   ├── admin.ts                 # Admin-only guard
│   │   ├── userTracker.ts           # Upserts user record on every message
│   │   ├── rateLimiter.ts           # 15 req/min per user (admins exempt)
│   │   ├── maintenance.ts           # Blocks all users when maintenance is ON
│   │   └── errorHandler.ts
│   └── utils/
│       ├── logger.ts
│       ├── helpers.ts               # normalizeQuery, buildMessageLink, formatFileSize …
│       ├── keyboards.ts             # All InlineKeyboardMarkup builders
│       ├── blockedTags.ts           # Cached blocked-tag checker (30s TTL)
│       └── health.ts                # HTTP /health endpoint for Render
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
| fileName | String | Fuzzy-searched (weight 0.65) |
| caption | String | Fuzzy-searched (weight 0.35) |
| category | String | Channel label |
| fileSize | Number | Bytes |
| fileId | String | Telegram file_id |

### `settings` — bot configuration
| Key | Description |
|-----|-------------|
| `maintenance` | `on` / `off` |
| `blocked_tags` | Comma-separated tags hidden from index entirely |
| `random_excluded_tags` | Tags hidden from `/random` only (still searchable) |
| `random_excluded_ids` | `channelId:messageId` pairs hidden from `/random` only |
| `request_url` | Shown when search returns no results |
| `vague_search_hint` | Custom "be more specific" message (use `{query}` as placeholder) |

---

## ⚙️ Setup

### Prerequisites
- Node.js 18+
- MongoDB Atlas free M0 cluster
- Telegram bot token from [@BotFather](https://t.me/BotFather)

### Install
```bash
git clone https://github.com/yourname/rom-finder-bot
cd rom-finder-bot
npm install
cp .env.example .env
```

### `.env`
```env
BOT_TOKEN=1234567890:ABCdef...
ADMIN_IDS=123456789
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/romfinder
CHANNELS=-1001234567890,-1009876543210
OWNER_NAME=Your Name
OWNER_HANDLE=yourtelegramusername    # NO @ symbol
SOURCE_CODE_URL=https://github.com/yourname/rom-finder-bot
```

### Run
```bash
npm run dev     # hot-reload development
npm run build   # compile TypeScript
npm start       # run compiled output
```

---

## 📡 Channel Setup

1. Add the bot as **admin** with "Post Messages" permission in each channel
2. Add channel IDs (comma-separated) to `CHANNELS` in your environment
3. Map each channel via `/set` → **Map Channels** → tap a channel → type its label
4. Run `/backfill` to index all historical files

**Getting a channel ID:** Forward any message from the channel to [@userinfobot](https://t.me/userinfobot). IDs always start with `-100`.

---

## 🔄 Backfill

`/backfill` scans a channel's full message history and indexes all file messages.

**How it works:** Iterates message IDs sequentially using `forwardMessage` — the only Bot API method that returns full file metadata for channel posts. `copyMessage` only returns `{message_id}` and is never used.

**How to run:**
1. `/maintenance` → ON
2. `/backfill` → select a channel
3. Wait for the progress updates
4. `/maintenance` → OFF

Details: resumes from last indexed ID, stops after 50 consecutive gaps, 380ms between requests, auto-waits on flood errors, forwarded messages auto-deleted.

---

## 🎲 /random Command

Returns a random indexed ROM to the user. Includes an **Another Random** button for instant re-roll.

**Exclusion system (admin-controlled via `/random_edit`):**
- **Tag exclusions** — any file whose caption contains an excluded tag is skipped from `/random`. The file remains fully searchable via `/search`.
- **File exclusions** — individual files can be excluded by forwarding them. Also remain in `/search`.
- Exclusions survive restarts (stored in MongoDB `settings`).

---

## 🚀 Deploy to Render

### 1 — Push to GitHub
```bash
git init && git add . && git commit -m "init"
git remote add origin https://github.com/yourname/rom-finder-bot
git push -u origin main
```

### 2 — Create Web Service
- [render.com](https://render.com) → **New → Web Service** → connect repo
- Build: `npm install && npm run build`
- Start: `npm start`

### 3 — Environment Variables

| Key | Value |
|-----|-------|
| `BOT_TOKEN` | Telegram bot token |
| `MONGODB_URI` | Atlas connection string |
| `ADMIN_IDS` | Comma-separated user IDs |
| `CHANNELS` | Comma-separated channel IDs |
| `OWNER_NAME` | Display name |
| `OWNER_HANDLE` | Telegram username (no @) |
| `SOURCE_CODE_URL` | GitHub repo URL |

> Render auto-sets `PORT` and `RENDER_EXTERNAL_URL` — webhook mode activates automatically.

### 4 — Keep Alive
Ping `https://your-app.onrender.com/health` every 5 min via [UptimeRobot](https://uptimerobot.com).

### 5 — First Run Checklist
```
✅ /ping responds
✅ /maintenance → ON
✅ /backfill for each channel
✅ /maintenance → OFF
✅ /set → Map Channels
✅ /set → Tag Categories (optional)
✅ /set → Request-It URL (optional)
✅ /search → verify results work
```

---

## 👮 Admin Command Reference

| Command | Description |
|---------|-------------|
| `/set` | Settings menu (channels, featured, request URL, tag categories) |
| `/db` | DB stats, clear cache/index, delete all data |
| `/users` | User statistics |
| `/broadcast` | Message all users (4-step with format validation) |
| `/backfill` | Index historical channel files |
| `/maintenance` | Toggle user access lock |
| `/unindex` | Remove files from search index by tag or forward |
| `/random_edit` | Manage /random exclusions (tags and individual files) |
| `/set_search_hint` | Customise the "be more specific" hint for single-word queries |
| `/helpa` | Full admin reference in-chat |

### `/random_edit` Details
- **Exclude by tag** — files with this tag never appear in `/random`; still in `/search`
- **Exclude a specific file** — forward the file to hide it from `/random` only
- **View/remove excluded tags** — list and re-allow tags
- **View/remove excluded files** — list and re-allow individual files by name

### `/set_search_hint` Details
Customise the warning shown when a user types a single generic word (e.g. `Pokemon`) during search. Use `{query}` as a placeholder — it is replaced with the user's word at display time.

---

## 🔒 Security & Rate Limiting

- **Rate limit:** 15 requests / 60 seconds per user; admins fully exempt
- **Admin checks:** re-verified on every command and every callback independently — no DB roles
- **Destructive operations:** always require a confirmation button
- **Bot token:** never logged

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
| Map Channels button silent | Check `CHANNELS` env var is set and redeploy |
| Search returns no results | Run `/backfill` — files uploaded before bot was admin aren't indexed |
| Backfill fails "Forbidden" | Bot needs admin + "Forward Messages" permission in channel |
| `/db` stats error | Ensure you're on v1.2.0+ — old versions used `db.stats()` (unsupported on M0) |
| MongoDB connection fails | Atlas → Network Access → add `0.0.0.0/0` |
| Bot sleeping on Render | UptimeRobot → ping `/health` every 5 min |
| Broadcast crashes on `_` | Use HTML mode for messages with underscores |

---

## ♻️ Adapting for Other File Types

Fork, replace all instances of `"ROM"` with your file type (e.g. `"Book"`, `"Mod"`), deploy. Everything else — search, indexing, feedback, admin tools — works identically.

---

## 📄 License

MIT — free to use, fork, and deploy.
