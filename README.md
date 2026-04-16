# 🎮 ROM Finder Bot

A production-ready Telegram bot that searches ROM files across multiple Telegram channels. Built with **Node.js + TypeScript + Telegraf**, backed by **MongoDB Atlas**, and deployable on **Render (free tier)**.

---

## 📁 Project Structure

```
rom-finder-bot/
├── src/
│   ├── index.ts                   # Entry point — bot init & launch
│   ├── config/
│   │   └── index.ts               # Env validation (Zod), constants
│   ├── models/
│   │   ├── User.ts                # User tracking schema
│   │   ├── Channel.ts             # Channel → category mapping
│   │   ├── ChannelMessage.ts      # Indexed ROM messages
│   │   ├── Search.ts              # Search frequency tracking
│   │   ├── Featured.ts            # Admin-curated featured ROMs
│   │   └── Setting.ts             # Bot settings (request URL, etc.)
│   ├── services/
│   │   ├── database.ts            # MongoDB connection + stats
│   │   ├── search.ts              # Core search engine (Fuse.js)
│   │   ├── cache.ts               # In-memory LRU cache
│   │   └── session.ts             # Per-user conversation state
│   ├── commands/
│   │   ├── basic.ts               # /start /help /about /ping
│   │   ├── discovery.ts           # /top /featured
│   │   ├── search.ts              # /search + result rendering
│   │   ├── admin.ts               # /set /db /users /helpa
│   │   └── broadcast.ts           # /broadcast
│   ├── handlers/
│   │   ├── channel.ts             # Indexes incoming channel posts
│   │   ├── callbacks.ts           # All inline keyboard callbacks
│   │   └── text.ts                # Multi-step text flow handler
│   ├── middleware/
│   │   ├── admin.ts               # Admin-only guard
│   │   ├── userTracker.ts         # Upserts user on every message
│   │   ├── rateLimiter.ts         # 20 req/min per user
│   │   └── errorHandler.ts        # Global Telegraf error handler
│   └── utils/
│       ├── logger.ts              # Winston logger
│       ├── helpers.ts             # normalizeQuery, buildLink, etc.
│       ├── keyboards.ts           # All InlineKeyboardMarkup builders
│       └── health.ts              # HTTP health check for Render
├── .env.example
├── render.yaml
├── tsconfig.json
└── package.json
```

---

## 🗄️ MongoDB Schema

### `users`
| Field | Type | Description |
|-------|------|-------------|
| userId | Number | Telegram user ID (unique) |
| username | String | @handle |
| firstName | String | Display name |
| isBlocked | Boolean | Blocked the bot |
| isDeleted | Boolean | Account deleted |
| joinedAt | Date | First seen |
| lastActiveAt | Date | Last activity |
| totalSearches | Number | Lifetime search count |

### `channelmessages`
| Field | Type | Description |
|-------|------|-------------|
| channelId | String | Source channel ID |
| messageId | Number | Telegram message ID |
| fileName | String | ROM file name |
| caption | String | Full caption text |
| category | String | GBA / NDS / etc. |
| fileSize | Number | Bytes |
| fileId | String | Telegram file ID |

**Indexes:** `(channelId, messageId)` unique · `fileName + caption` text index · `category`

### `channels`
| Field | Type | Description |
|-------|------|-------------|
| channelId | String | Channel ID (unique) |
| category | String | Enum: GBA, NDS, 3DS… |
| title | String | Channel display name |
| mappedBy | Number | Admin user ID |

### `searches`
| Field | Type | Description |
|-------|------|-------------|
| query | String | Original query |
| normalizedQuery | String | Lowercased, trimmed (unique) |
| count | Number | Search frequency |
| lastSearchedAt | Date | Last searched |

**Index:** `count: -1` for fast /top queries

### `featureds`
| Field | Type | Description |
|-------|------|-------------|
| position | Number | 1–10 (unique) |
| title | String | Display title |
| channelId | String | Source channel |
| messageId | Number | Message to link |
| category | String | ROM category |
| addedBy | Number | Admin who set it |

### `settings`
| Field | Type | Description |
|-------|------|-------------|
| key | String | Setting key (unique) |
| value | String | Setting value |
| updatedBy | Number | Admin user ID |

---

## ⚙️ Setup & Local Development

### Prerequisites
- Node.js 18+
- MongoDB Atlas account (free M0 cluster)
- Telegram Bot Token from [@BotFather](https://t.me/BotFather)

### 1. Clone & install
```bash
git clone https://github.com/yourname/rom-finder-bot
cd rom-finder-bot
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```

Edit `.env`:
```env
BOT_TOKEN=1234567890:ABCdef...
ADMIN_IDS=123456789
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/romfinder
CHANNELS=-1001234567890,-1009876543210
OWNER_USERNAME=@yourhandle
OWNER_NAME=Your Name
```

### 3. Run in development
```bash
npm run dev
```

### 4. Build for production
```bash
npm run build
npm start
```

---

## 📡 Channel Setup

### Adding channels to the bot

1. **Add the bot as admin** to each Telegram channel with "Post Messages" permission.
2. **List channel IDs** in `.env`:
   ```
   CHANNELS=-1001234567890,-1009876543210,-1005555555555
   ```
3. **Map each channel to a category** via `/set` → "Map Channels to Categories" in Telegram.

### Getting a channel ID
- Forward a message from the channel to [@userinfobot](https://t.me/userinfobot)
- Or use [@username_to_id_bot](https://t.me/username_to_id_bot)
- Channel IDs always start with `-100`

### How indexing works
Once the bot is an admin in a channel, **every new file post** (document, video, audio) is automatically indexed into MongoDB with:
- File name
- Caption text
- Category (from channel mapping or `#hashtag` in caption)
- File size

Edited posts update the index. The bot also builds an in-memory Fuse.js index for fast fuzzy search, refreshed every 30 minutes per channel.

---

## 🔍 Search Algorithm

1. **Normalize** query: lowercase, trim, collapse whitespace
2. **Cache check**: if exact query+category is cached, return immediately
3. **Channel selection**: query mapped channels for chosen category (or all channels)
4. **Load messages**: from in-memory index (rebuilt from DB, TTL 30min)
5. **Fuse.js fuzzy search** with weighted fields:
   - `fileName` weight: 0.6
   - `caption` weight: 0.4
   - Threshold: 0.5 (lenient matching)
6. **Rank & slice**: top result = best match, rest = other matches (max 10 total)
7. **Cache result** with LRU eviction (max 200 entries, 1hr TTL)
8. **Record search** in DB for `/top` command

---

## 🚀 Deploy to Render

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/yourname/rom-finder-bot
git push -u origin main
```

### Step 2 — Create Render Web Service

1. Go to [render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub repository
3. Render auto-detects `render.yaml` — confirm the settings:
   - **Environment:** Node
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Plan:** Free

### Step 3 — Set Environment Variables

In Render dashboard → Environment tab, add:

| Key | Value |
|-----|-------|
| `BOT_TOKEN` | Your bot token |
| `MONGODB_URI` | Atlas connection string |
| `ADMIN_IDS` | `123456789` |
| `CHANNELS` | `-1001234567890,-1009876543210` |
| `OWNER_USERNAME` | `@yourhandle` |
| `OWNER_NAME` | `Your Name` |

> Render automatically sets `PORT` and `RENDER_EXTERNAL_URL` — the bot uses these for webhook mode.

### Step 4 — Deploy

Click **"Create Web Service"**. Render will:
1. Clone the repo
2. Run `npm install && npm run build`
3. Start the bot
4. Set up the webhook automatically via `RENDER_EXTERNAL_URL`

### Step 5 — Keep alive (important for free tier)

Render's free tier sleeps after 15 minutes of inactivity. The bot includes a `/health` HTTP endpoint. Set up a free uptime monitor:

- [UptimeRobot](https://uptimerobot.com) — ping `https://your-app.onrender.com/health` every 5 minutes
- [cron-job.org](https://cron-job.org) — free cron pinger

---

## 🤖 BotFather Setup

After your bot is running, set the command list in BotFather:

```
/setcommands → your_bot
```

Paste:
```
start - Welcome message
search - Search for a ROM
top - Top 5 most searched ROMs
featured - Admin-curated ROM list
about - Bot info and channels
ping - Check bot latency
help - Command guide
```

---

## 👮 Admin Usage Guide

### Map a channel to a category
1. `/set` → "Map Channels to Categories"
2. Tap a channel button
3. Select its category (GBA, NDS, etc.)
4. Confirm if replacing an existing mapping

### Set featured ROMs
1. `/set` → "Set Featured ROMs"
2. Select position 1–10
3. **Forward** a message from a ROM channel to the bot
   — OR send in format: `Title | -100xxxxxxxxxx | messageId`

### Set Request-It URL
1. `/set` → "Set Request-It URL"
2. Send the URL (Google Form, group link, etc.)

### Broadcast a message
1. `/broadcast`
2. Type your message (supports Markdown)
3. Confirm the preview
4. Bot sends to all active users, reports delivery stats

### Database tools
- `/db` → Stats: MongoDB size, cache hit rate, collection counts
- `/db` → Clear Cache: invalidates in-memory search cache
- `/db` → Clear Index: forces re-index of all channels on next search
- `/db` → Delete All Data: nuclear option with double confirmation

---

## 🔒 Security

- Admin commands are protected by `ADMIN_IDS` env check — no role in DB
- Rate limiter: 20 requests/minute per user
- Input validation on all text inputs (length, format)
- No user data leaked cross-user
- Delete confirmation required for destructive operations
- Bot token never exposed in logs or responses

---

## 📊 Performance on Free Tier

| Metric | Value |
|--------|-------|
| MongoDB | Free M0 (512MB) |
| Cache | In-memory LRU, max 200 entries |
| Search latency | ~50–200ms (cache hit <5ms) |
| Message index TTL | 30 minutes |
| Rate limit | 20 req/min per user |
| Broadcast delay | 35ms between messages |

---

## 🛠️ Troubleshooting

**Bot not receiving channel messages?**
- Ensure the bot is an **admin** with "Post Messages" permission in the channel
- Confirm the channel ID in `CHANNELS` env starts with `-100`

**"No channels configured" error?**
- Check `CHANNELS` env var is set (comma-separated IDs)
- Map channels via `/set` → "Map Channels to Categories"

**Search returns no results?**
- Messages are indexed as they arrive — the bot must be admin in the channel first
- For existing messages, use `/db` → "Clear Index" to trigger re-index

**MongoDB connection fails?**
- Ensure your Atlas cluster's IP whitelist includes `0.0.0.0/0` (allow all) for Render
- Check the connection string includes `?retryWrites=true&w=majority`

---

## 📄 License

MIT — free to use, modify, and deploy.
