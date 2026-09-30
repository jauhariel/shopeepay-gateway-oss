import { state } from "../config";

const BASE_URL = "https://shopeepay.shopee.co.id/merchant/v1/partner-web";
// API notifikasi partner portal (real-time, tidak mengalami delay indexing
// seperti get-transaction-list); memakai token "B:" yang sama.
const NOTIF_URL =
  "https://api.partner.shopee.co.id/nb/mss/web-api/PartnerServer/GetNotificationList";

// Pool user-agent realistis untuk rotasi request
const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
];

const randomUA = () => userAgents[Math.floor(Math.random() * userAgents.length)];

const statusMap: Record<number, string> = {
  1: "pending",
  2: "failed",
  3: "success",
  4: "refunded",
  5: "expired",
};

export interface ShopeeTransaction {
  transactionId: string;
  displayTransactionId?: string;
  amount: string | number;
  status: number;
  createTime: number;
}

export interface TransactionListResponse {
  code: number;
  msg?: string;
  data?: {
    list?: ShopeeTransaction[];
    next_position?: string;
    totalNetSales?: string;
  };
}

export interface TransactionDetailResponse {
  code: number;
  msg?: string;
  data?: { issuer?: string };
}

export interface ShopeeNotification {
  actionId: string;
  title: string;
  content: string;
  createTime: number;
  actionType: number;
  unreadStatus: number;
  pcRedirectUrl?: string;
}

export interface NotificationListResponse {
  code?: number;
  msg?: string;
  data?: { list?: ShopeeNotification[]; cursor?: string | number };
}

function buildHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Origin: "https://partner.shopee.co.id",
    Referer: "https://partner.shopee.co.id/",
    "User-Agent": randomUA(),
    "X-Timestamp-Ms": String(Date.now()),
  };
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  return (await res.json()) as T;
}

export async function callShopeeAPI(
  startTime: number,
  endTime: number,
  pageSize: number,
  nextPos: string,
  token: string = state.shopeeToken,
): Promise<TransactionListResponse> {
  return postJson<TransactionListResponse>("/get-transaction-list", {
    data: {
      metadata: { token, language: "id", timezone: "Asia/Jakarta" },
      pageSize,
      filter: { startTime, endTime, serviceList: [1, 3] },
      sorter: { field: "createTime", order: "descend" },
      next_position: nextPos || "",
    },
  });
}

export async function callShopeeDetailAPI(
  orderSN: string,
  token: string = state.shopeeToken,
): Promise<TransactionDetailResponse> {
  return postJson<TransactionDetailResponse>("/get-transaction-detail", {
    data: {
      metadata: { token, language: "id", timezone: "Asia/Jakarta" },
      order_sn: orderSN,
    },
  });
}

export async function callShopeeNotificationAPI(
  cursor: number | string = 0,
  limit: number = 20,
  token: string = state.shopeeToken,
): Promise<NotificationListResponse> {
  const res = await fetch(NOTIF_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Merchant-Token": token,
      "X-Merchant-Language": "id",
      "X-Merchant-Timezone": "Asia/Jakarta",
    },
    body: JSON.stringify({ cursor, limit }),
    signal: AbortSignal.timeout(20_000),
  });
  return (await res.json()) as NotificationListResponse;
}

export function toWIB(date: Date): string {
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${wib.getUTCFullYear()}-${pad(wib.getUTCMonth() + 1)}-${pad(
    wib.getUTCDate(),
  )} ${pad(wib.getUTCHours())}:${pad(wib.getUTCMinutes())}:${pad(wib.getUTCSeconds())}`;
}

export function parseAmount(raw: string | number | undefined): number {
  const clean = String(raw ?? "0").replace(/\./g, "").replace(/,/g, "");
  return parseInt(clean, 10) || 0;
}

export function formatTransaction(t: ShopeeTransaction) {
  return {
    amount: parseAmount(t.amount),
    status: statusMap[t.status] ?? `unknown_${t.status}`,
    time: toWIB(new Date(t.createTime * 1000)),
  };
}

/** actionType 1219 = "Pembayaran sebesar Rp X diterima" pada transaksi <id>. */
const PAYMENT_RECEIVED_ACTION_TYPE = 1219;

export interface ParsedPaymentNotification {
  transactionId: string;
  amount: number;
  title: string;
  createTime: number;
  source: "notification";
}

/**
 * Ubah notifikasi "pembayaran diterima" menjadi entri setara transaksi.
 * Mengembalikan null untuk jenis notifikasi lain (payout, promo, dll).
 */
export function parsePaymentNotification(
  n: ShopeeNotification,
): ParsedPaymentNotification | null {
  if (n.actionType !== PAYMENT_RECEIVED_ACTION_TYPE) return null;

  const idMatch = n.pcRedirectUrl?.match(/[?&]transactionId=([^&]+)/);
  const titleMatch = n.title.match(/Rp\s?([\d.,]+)/);
  if (!idMatch || !titleMatch) return null;

  return {
    transactionId: idMatch[1],
    amount: parseAmount(titleMatch[1]),
    title: n.title,
    createTime: n.createTime,
    source: "notification",
  };
}
