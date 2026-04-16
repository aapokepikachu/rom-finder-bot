import { InlineKeyboardButton, InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { CATEGORIES, Category } from '../config';
import { chunk } from './helpers';

import { SearchResult } from '../services/cache';

export function buildCategoryKeyboard(selected?: string): InlineKeyboardMarkup {
  const buttons: InlineKeyboardButton[] = CATEGORIES.map((cat) => ({
    text: selected === cat ? `✅ ${cat}` : cat,
    callback_data: `search_cat:${cat}`,
  }));

  const notSureButton: InlineKeyboardButton = {
    text: "🎲 I'm not sure (Search All)",
    callback_data: 'search_cat:ALL',
  };

  const rows = chunk(buttons, 4);
  rows.push([notSureButton]);

  return { inline_keyboard: rows };
}

export function buildChannelMappingKeyboard(
  channels: string[],
  mappedChannels: any[]
): InlineKeyboardMarkup {
  const mappedMap = new Map(mappedChannels.map((c) => [c.channelId, c.category]));

  const buttons: InlineKeyboardButton[] = channels.map((chId) => {
    const category = mappedMap.get(chId);
    const label = category ? `✅ ${chId} → ${category}` : `⚙️ ${chId}`;
    return {
      text: label,
      callback_data: `map_channel:${chId}`,
    };
  });

  const rows = chunk(buttons, 1);
  rows.push([{ text: '❌ Cancel', callback_data: 'admin_cancel' }]);

  return { inline_keyboard: rows };
}

export function buildCategoryAssignKeyboard(channelId: string): InlineKeyboardMarkup {
  const buttons: InlineKeyboardButton[] = CATEGORIES.map((cat) => ({
    text: cat,
    callback_data: `assign_cat:${channelId}:${cat}`,
  }));

  const rows = chunk(buttons, 4);
  rows.push([{ text: '⬅️ Back', callback_data: 'map_back' }]);

  return { inline_keyboard: rows };
}

export function buildConfirmKeyboard(action: string, payload?: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: '✅ Yes, confirm',
          callback_data: `confirm:${action}:${payload || ''}`,
        },
        {
          text: '❌ No, cancel',
          callback_data: 'admin_cancel',
        },
      ],
    ],
  };
}

export function buildAdminSettingsKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '⭐ Set Featured ROMs', callback_data: 'admin_set:featured' }],
      [{ text: '📡 Map Channels to Categories', callback_data: 'admin_set:channels' }],
      [{ text: '🔗 Set Request-It URL', callback_data: 'admin_set:request_url' }],
      [{ text: '❌ Close', callback_data: 'admin_cancel' }],
    ],
  };
}

export function buildDbToolsKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '📊 View Usage Stats', callback_data: 'db:stats' }],
      [{ text: '🗑️ Delete All Data', callback_data: 'db:delete_all' }],
      [{ text: '🧹 Clear Search Cache', callback_data: 'db:clear_cache' }],
      [{ text: '🔄 Clear Message Index', callback_data: 'db:clear_index' }],
      [{ text: '❌ Close', callback_data: 'admin_cancel' }],
    ],
  };
}

export function buildResultKeyboard(
  bestMatch: SearchResult,
  otherMatches: SearchResult[],
  requestUrl?: string
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [
    [{ text: '⬇️ Download', url: bestMatch.messageLink }],
  ];

  if (otherMatches.length > 0) {
    rows.push([{ text: '📋 Show More Results', callback_data: 'show_more_results' }]);
  }

  if (requestUrl) {
    rows.push([{ text: '📨 Request a ROM', url: requestUrl }]);
  }

  return { inline_keyboard: rows };
}

export function buildRequestItKeyboard(requestUrl?: string): InlineKeyboardMarkup {
  if (requestUrl) {
    return {
      inline_keyboard: [
        [{ text: '📨 Request It!', url: requestUrl }],
        [{ text: '🔄 Try Different Search', callback_data: 'search_again' }],
      ],
    };
  }
  return {
    inline_keyboard: [
      [{ text: '🔄 Try Different Search', callback_data: 'search_again' }],
    ],
  };
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
      [{ text: '📢 Send Broadcast', callback_data: 'broadcast:confirm' }],
      [{ text: '❌ Cancel', callback_data: 'admin_cancel' }],
    ],
  };
}
