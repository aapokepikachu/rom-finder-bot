/**
 * In-memory session store for multi-step conversation flows.
 * Keeps state per-user without needing a persistent session DB.
 */

export type SessionState =
  | { step: 'idle' }
  | { step: 'search_category' }
  | { step: 'search_query'; category?: string }
  | { step: 'broadcast_compose' }
  | { step: 'broadcast_confirm'; message: string }
  | { step: 'set_request_url' }
  | { step: 'set_featured_pick_pos' }
  | { step: 'set_featured_pick_msg'; position: number }
  | { step: 'await_more_results'; results: import('./cache').SearchResult[]; requestUrl?: string };

interface SessionEntry {
  state: SessionState;
  updatedAt: number;
}

const sessions = new Map<number, SessionEntry>();
const SESSION_TTL = 10 * 60 * 1000; // 10 minutes

// Cleanup stale sessions every 15 minutes
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
