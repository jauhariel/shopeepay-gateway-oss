const TTL_MS = 24 * 60 * 60 * 1000; // 24 jam

/** transactionId -> waktu klaim (epoch ms) */
const claimed = new Map<string, number>();

export function isClaimed(transactionId: string): boolean {
  const at = claimed.get(transactionId);
  if (at === undefined) return false;
  if (Date.now() - at > TTL_MS) {
    claimed.delete(transactionId);
    return false;
  }
  return true;
}

export function claim(transactionId: string) {
  claimed.set(transactionId, Date.now());
}

// Bersihkan entri kedaluwarsa tiap jam agar Map tidak membengkak
setInterval(() => {
  const now = Date.now();
  for (const [id, at] of claimed) {
    if (now - at > TTL_MS) claimed.delete(id);
  }
}, 60 * 60 * 1000).unref();
