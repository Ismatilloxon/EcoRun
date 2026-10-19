type Sock = { send: (data: string) => void; readyState: number };

const byUser = new Map<string, Set<Sock>>();
const byRun = new Map<string, Set<Sock>>();

export function addUserSocket(userId: string, s: Sock) {
  if (!byUser.has(userId)) byUser.set(userId, new Set());
  byUser.get(userId)!.add(s);
}

export function joinRunRoom(runId: string, s: Sock) {
  if (!byRun.has(runId)) byRun.set(runId, new Set());
  byRun.get(runId)!.add(s);
}

export function removeSocket(s: Sock) {
  for (const m of [byUser, byRun]) {
    for (const [k, set] of m) {
      set.delete(s);
      if (!set.size) m.delete(k);
    }
  }
}

function send(set: Set<Sock> | undefined, payload: unknown) {
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const s of set) if (s.readyState === 1) s.send(data);
}

export const emitToUser = (userId: string, payload: unknown) => send(byUser.get(userId), payload);
export const emitToRun = (runId: string, payload: unknown) => send(byRun.get(runId), payload);
export const onlineCount = () => byUser.size;
