export type BroadcastParseMode = 'none' | 'Markdown' | 'HTML';

export type SessionState =
  | { step: 'idle' }
  | { step: 'search_category' }
  | { step: 'search_query'; category?: string; categoryLabel?: string }
  | { step: 'broadcast_compose' }
  | { step: 'broadcast_pick_format'; message: string }
  | { step: 'broadcast_confirm'; message: string; parseMode: BroadcastParseMode }
  | { step: 'set_request_url' }
  | { step: 'set_featured_pick_pos' }
  | { step: 'set_featured_pick_msg'; position: number }
  | { step: 'map_channel_label'; channelId: string }
  | { step: 'tag_cat_awaiting_tag' }          // step 1: waiting for the #tag
  | { step: 'tag_cat_awaiting_label'; tag: string }  // step 2: waiting for the button label
  | { step: 'await_more_results'; results: import('./cache').SearchResult[]; requestUrl?: string }
  | { step: 'unindex_by_tag' }
  | { step: 'unindex_by_forward' };

interface SessionEntry {
  state: SessionState;
  updatedAt: number;
}

const sessions = new Map<number, SessionEntry>();
const SESSION_TTL = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of sessions.entries()) {
    if (now - entry.updatedAt > SESSION_TTL) sessions.delete(key);
  }
}, 15 * 60 * 1000);

export function getSession(userId: number): SessionState {
  const entry = sessions.get(userId);
  if (!entry || Date.now() - entry.updatedAt > SESSION_TTL) return { step: 'idle' };
  return entry.state;
}

export function setSession(userId: number, state: SessionState): void {
  sessions.set(userId, { state, updatedAt: Date.now() });
}

export function clearSession(userId: number): void {
  sessions.delete(userId);
}
