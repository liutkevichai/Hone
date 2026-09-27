/** Refines (and undos) that are queued or running, per user, keyed `chatId:messageId`
 *  with a count (the same message can be queued more than once). Unlike
 *  the cancel registry, entries exist from enqueue time, not only once a
 *  queue slot starts. Lets a frontend that missed `refine-complete` (e.g.
 *  its socket was suspended while the tab was hidden) reconcile its busy
 *  indicators against what is actually still in flight. */
const pending = new Map<string, Map<string, number>>();

function entryKey(chatId: string, messageId: string): string {
  return `${chatId}:${messageId}`;
}

/** Mark a refine as pending. Returns an idempotent release function. */
export function markPending(userId: string, chatId: string, messageId: string): () => void {
  const key = entryKey(chatId, messageId);
  let forUser = pending.get(userId);
  if (!forUser) {
    forUser = new Map();
    pending.set(userId, forUser);
  }
  forUser.set(key, (forUser.get(key) ?? 0) + 1);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = pending.get(userId);
    if (!current) return;
    const count = (current.get(key) ?? 0) - 1;
    if (count > 0) current.set(key, count);
    else current.delete(key);
    if (current.size === 0) pending.delete(userId);
  };
}

/** Message ids with a queued or running refine in the given chat. */
export function listPendingMessageIds(userId: string, chatId: string): string[] {
  const forUser = pending.get(userId);
  if (!forUser) return [];
  const prefix = `${chatId}:`;
  const ids: string[] = [];
  for (const key of forUser.keys()) {
    if (key.startsWith(prefix)) ids.push(key.slice(prefix.length));
  }
  return ids;
}
