import { InlineKeyboardButton, InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { chunk } from './helpers';
import { IChannel } from '../models/Channel';
import { ITagCategory } from '../models/TagCategory';
import { SearchResult } from '../services/cache';
import { TAG_CATEGORY_PREFIX } from '../services/search';

// ── Search keyboard ──────────────────────────────────────────────────────────

/**
 * Build the /search category picker.
 * Shows channel-based categories first, then tag-based categories, then "Search All".
 */
export function buildSearchCategoryKeyboard(
  channelCategories: IChannel[],
  tagCategories:     ITagCategory[]
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];

  // Channel-based categories
  for (const ch of channelCategories) {
    rows.push([{ text: ch.label, callback_data: `search_cat:${ch.channelId}` }]);
  }

  // Tag-based categories
  for (const tc of tagCategories) {
    rows.push([{ text: tc.label, callback_data: `search_cat:${TAG_CATEGORY_PREFIX}${tc.tag}` }]);
  }

  // Always last
  rows.push([{ text: "🎲 I'm not sure (Search All)", callback_data: 'search_cat:ALL' }]);

  return { inline_keyboard: rows };
}

// ── Result keyboards ─────────────────────────────────────────────────────────

export function buildResultKeyboard(
  bestMatch:    SearchResult,
  otherMatches: SearchResult[],
  requestUrl?:  string
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [
    [{ text: '⬇️ Download', url: bestMatch.messageLink }],
  ];
  if (otherMatches.length > 0) {
    rows.push([{ text: `📋 ${otherMatches.length} More Result(s) ⬆️`, callback_data: 'show_more_results' }]);
  }
  if (requestUrl) {
    rows.push([{ text: '📨 Request a ROM', url: requestUrl }]);
  }
  return { inline_keyboard: rows };
}

export function buildFeedbackKeyboard(payload: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: '✅ Yes, got it!',        callback_data: `feedback:yes:${payload}` },
      { text: '❌ No, not what I need', callback_data: `feedback:no:${payload}`  },
    ]],
  };
}

export function buildRequestItKeyboard(requestUrl?: string): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [
    [{ text: '🔄 Try Different Search', callback_data: 'search_again' }],
  ];
  if (requestUrl) {
    rows.push([{ text: '📨 Request It!', url: requestUrl }]);
  }
  return { inline_keyboard: rows };
}

// ── Channel mapping keyboard ─────────────────────────────────────────────────

/**
 * Shows:
 *  [🏷️ Set Tag Category]   ← new button at top
 *  [⚙️ Map -100xxx] or [✅ Label]  ← one per channel
 *  [❌ Cancel]
 */
export function buildChannelMappingKeyboard(
  channels:       string[],
  mappedChannels: IChannel[]
): InlineKeyboardMarkup {
  const mappedMap = new Map(mappedChannels.map((c) => [c.channelId, c]));

  const rows: InlineKeyboardButton[][] = [
    // Tag category button at the very top
    [{ text: '🏷️ Set Tag Category', callback_data: 'tag_cat:new' }],
  ];

  for (const chId of channels) {
    const mapped = mappedMap.get(chId);
    rows.push([{
      text:          mapped ? `✅ ${mapped.label}` : `⚙️ Map ${chId}`,
      callback_data: `map_channel:${chId}`,
    }]);
  }

  rows.push([{ text: '📋 Manage Tag Categories', callback_data: 'tag_cat:list' }]);
  rows.push([{ text: '❌ Cancel', callback_data: 'admin_cancel' }]);

  return { inline_keyboard: rows };
}

// ── Admin keyboards ──────────────────────────────────────────────────────────

export function buildAdminSettingsKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '⭐ Set Featured ROMs',          callback_data: 'admin_set:featured'    }],
      [{ text: '📡 Map Channels to Categories',  callback_data: 'admin_set:channels'    }],
      [{ text: '🔗 Set Request-It URL',          callback_data: 'admin_set:request_url' }],
      [{ text: '❌ Close',                        callback_data: 'admin_cancel'          }],
    ],
  };
}

export function buildDbToolsKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '📊 View Usage Stats',    callback_data: 'db:stats'       }],
      [{ text: '🗑️ Delete All Data',     callback_data: 'db:delete_all'  }],
      [{ text: '🧹 Clear Search Cache',  callback_data: 'db:clear_cache' }],
      [{ text: '🔄 Clear Message Index', callback_data: 'db:clear_index' }],
      [{ text: '❌ Close',                callback_data: 'admin_cancel'   }],
    ],
  };
}

export function buildConfirmKeyboard(action: string, payload?: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: '✅ Yes, confirm', callback_data: `confirm:${action}:${payload || ''}` },
      { text: '❌ No, cancel',   callback_data: 'admin_cancel' },
    ]],
  };
}

export function buildFeaturedPositionKeyboard(existingPositions: number[]): InlineKeyboardMarkup {
  const positions = Array.from({ length: 10 }, (_, i) => i + 1);
  const buttons: InlineKeyboardButton[] = positions.map((pos) => ({
    text:          existingPositions.includes(pos) ? `🔄 #${pos}` : `#${pos}`,
    callback_data: `feat_pos:${pos}`,
  }));
  const rows = chunk(buttons, 5);
  rows.push([{ text: '❌ Cancel', callback_data: 'admin_cancel' }]);
  return { inline_keyboard: rows };
}

export function buildBroadcastConfirmKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '📢 Send Broadcast', callback_data: 'broadcast:confirm' }],
      [{ text: '❌ Cancel',          callback_data: 'admin_cancel'      }],
    ],
  };
}

// ── Tag category management keyboard ─────────────────────────────────────────

export function buildTagCategoryListKeyboard(
  tagCategories: ITagCategory[]
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = tagCategories.map((tc) => ([{
    text:          `🗑️ Remove: ${tc.label} (${tc.tag})`,
    callback_data: `tag_cat_remove:${tc.tag}`,
  }]));
  rows.push([{ text: '➕ Add New Tag Category', callback_data: 'tag_cat:new'    }]);
  rows.push([{ text: '⬅️ Back',                 callback_data: 'tag_cat:back'   }]);
  return { inline_keyboard: rows };
}

// ── No-results keyboard ───────────────────────────────────────────────────────

/**
 * Shown when a search returns zero results.
 * If the user searched within a category, offer to try all channels.
 */
export function buildNoResultsKeyboard(
  requestUrl?: string,
  hadCategory?: boolean
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];

  if (hadCategory) {
    rows.push([{ text: '🔍 Try Searching All Channels', callback_data: 'search_no_result_all' }]);
  }
  rows.push([{ text: '🔄 Search Again', callback_data: 'search_again' }]);

  if (requestUrl) {
    rows.push([{ text: '📩 Request This ROM', url: requestUrl }]);
  }

  return { inline_keyboard: rows };
}
