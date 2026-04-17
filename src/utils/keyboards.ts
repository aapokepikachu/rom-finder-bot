import { InlineKeyboardButton, InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { chunk } from './helpers';
import { IChannel } from '../models/Channel';
import { SearchResult } from '../services/cache';

// ── Search keyboards ─────────────────────────────────────────────────────────

/**
 * Build the /search category keyboard dynamically from mapped channels.
 * Always includes "I'm not sure (Search All)" as last button.
 * If no channels mapped yet, only shows the "Search All" button.
 */
export function buildSearchCategoryKeyboard(
  mappedChannels: IChannel[]
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];

  // One button per mapped channel using admin-defined label
  for (const ch of mappedChannels) {
    rows.push([
      {
        text: ch.label,
        callback_data: `search_cat:${ch.channelId}`,
      },
    ]);
  }

  // Always last
  rows.push([
    {
      text: "🎲 I'm not sure (Search All)",
      callback_data: 'search_cat:ALL',
    },
  ]);

  return { inline_keyboard: rows };
}

// ── Channel mapping keyboards ────────────────────────────────────────────────

export function buildChannelMappingKeyboard(
  channels: string[],
  mappedChannels: IChannel[]
): InlineKeyboardMarkup {
  const mappedMap = new Map(mappedChannels.map((c) => [c.channelId, c]));

  const buttons: InlineKeyboardButton[] = channels.map((chId) => {
    const mapped = mappedMap.get(chId);
    const label = mapped
      ? `✅ ${mapped.label} (${chId})`
      : `⚙️ Map ${chId}`;
    return {
      text: label,
      callback_data: `map_channel:${chId}`,
    };
  });

  const rows = chunk(buttons, 1);
  rows.push([{ text: '❌ Cancel', callback_data: 'admin_cancel' }]);

  return { inline_keyboard: rows };
}

// ── Admin keyboards ──────────────────────────────────────────────────────────

export function buildConfirmKeyboard(action: string, payload?: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✅ Yes, confirm', callback_data: `confirm:${action}:${payload || ''}` },
        { text: '❌ No, cancel',   callback_data: 'admin_cancel' },
      ],
    ],
  };
}

export function buildAdminSettingsKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '⭐ Set Featured ROMs',         callback_data: 'admin_set:featured'     }],
      [{ text: '📡 Map Channels to Categories', callback_data: 'admin_set:channels'     }],
      [{ text: '🔗 Set Request-It URL',         callback_data: 'admin_set:request_url'  }],
      [{ text: '❌ Close',                       callback_data: 'admin_cancel'           }],
    ],
  };
}

export function buildDbToolsKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '📊 View Usage Stats',    callback_data: 'db:stats'        }],
      [{ text: '🗑️ Delete All Data',     callback_data: 'db:delete_all'   }],
      [{ text: '🧹 Clear Search Cache',  callback_data: 'db:clear_cache'  }],
      [{ text: '🔄 Clear Message Index', callback_data: 'db:clear_index'  }],
      [{ text: '❌ Close',                callback_data: 'admin_cancel'    }],
    ],
  };
}

// ── Result keyboards ─────────────────────────────────────────────────────────

export function buildResultKeyboard(
  bestMatch: SearchResult,
  otherMatches: SearchResult[],
  requestUrl?: string
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [
    [{ text: '⬇️ Download', url: bestMatch.messageLink }],
  ];

  if (otherMatches.length > 0) {
    rows.push([{ text: `📋 ${otherMatches.length} More Result(s)`, callback_data: 'show_more_results' }]);
  }

  if (requestUrl) {
    rows.push([{ text: '📨 Request a ROM', url: requestUrl }]);
  }

  return { inline_keyboard: rows };
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

export function buildFeaturedPositionKeyboard(existingPositions: number[]): InlineKeyboardMarkup {
  const positions = Array.from({ length: 10 }, (_, i) => i + 1);
  const buttons: InlineKeyboardButton[] = positions.map((pos) => ({
    text: existingPositions.includes(pos) ? `🔄 #${pos}` : `#${pos}`,
    callback_data: `feat_pos:${pos}`,
  }));

  const rows = chunk(buttons, 5);
  rows.push([{ text: '❌ Cancel', callback_data: 'admin_cancel' }]);
  return { inline_keyboard: rows };
}

export function buildBroadcastConfirmKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '📢 Send Broadcast',  callback_data: 'broadcast:confirm' }],
      [{ text: '❌ Cancel',           callback_data: 'admin_cancel'      }],
    ],
  };
}
