import { afterEach, describe, expect, test } from "bun:test";
import { app } from "../src/app";
import { state } from "../src/config";

const KEY = "test-key-123";
const BASE = "http://localhost";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jsonOf = async (res: Response): Promise<any> => res.json();

const get = (path: string, key?: string) =>
  app.handle(
    new Request(BASE + path, key ? { headers: { "X-API-Key": key } } : undefined),
  );

const post = (path: string, body: unknown, key?: string) =>
  app.handle(
    new Request(BASE + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { "X-API-Key": key } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

// ── Mock fetch untuk panggilan ke ShopeePay ──────────────────────────────────
const realFetch = globalThis.fetch;

const asFetch = (fn: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) =>
  fn as unknown as typeof fetch;

function mockShopee(list: unknown[], detail?: unknown) {
  globalThis.fetch = asFetch(async (input) => {
    const url = String(input);
    const json = url.includes("get-transaction-detail")
      ? (detail ?? { code: 0, data: { issuer: "OVO" } })
      : { code: 0, data: { list, totalNetSales: "1.008" } };
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

function mockNotifications(list: unknown[], fail = false) {
  globalThis.fetch = asFetch(async (input) => {
    const url = String(input);
    if (url.includes("GetNotificationList")) {
      const json = fail
        ? { code: 99000000, msg: "notification api down" }
        : { data: { list, cursor: "999" } };
      return new Response(JSON.stringify(json), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const json = url.includes("get-transaction-detail")
      ? { code: 0, data: { issuer: "OVO" } }
      : { code: 0, data: { list: [], totalNetSales: "0" } };
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

const paymentNotif = (amount: string, txId: string, createTime: number) => ({
  actionId: `act-${txId}`,
  title: `Payment of Rp${amount} received`,
  content: `A payment of <b>Rp${amount}</b> has been received. Ref: <b>${txId}</b>.`,
  createTime,
  actionType: 1219,
  unreadStatus: 1,
  pcRedirectUrl: `https://partner.shopee.co.id/transactions?transactionId=${txId}&utm_medium=notification`,
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("endpoint publik", () => {
  test("GET / mengembalikan banner", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Shoppe API Running");
  });

  test("GET /api/health mengembalikan status sehat", async () => {
    const res = await get("/api/health");
    const body = await jsonOf(res);
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toContain("running");
  });

  test("GET /qr/:id tidak dikenal mengembalikan 404", async () => {
    const res = await get("/qr/tidak-ada");
    expect(res.status).toBe(404);
  });

  test("GET /qr/:id kedaluwarsa mengembalikan 410", async () => {
    state.qrisStore.set("expired1", { data: "x", expiresAt: Date.now() - 1000 });
    const res = await get("/qr/expired1");
    expect(res.status).toBe(410);
  });
});

describe("auth API key", () => {
  test("tanpa key ditolak 401", async () => {
    const res = await get("/token-status");
    expect(res.status).toBe(401);
    expect((await jsonOf(res)).success).toBe(false);
  });

  test("key salah ditolak 401", async () => {
    const res = await get("/token-status", "key-ngasal");
    expect(res.status).toBe(401);
  });

  test("key via header diterima", async () => {
    const res = await get("/token-status", KEY);
    expect(res.status).toBe(200);
  });

  test("key via query string diterima", async () => {
    const res = await get(`/token-status?api_key=${KEY}`);
    expect(res.status).toBe(200);
  });
});

describe("token management", () => {
  test("POST /update-token memperbarui token di state", async () => {
    const res = await post("/update-token", { token: "B:token-baru" }, KEY);
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).success).toBe(true);
    expect(state.shopeeToken).toBe("B:token-baru");
  });

  test("POST /update-token tanpa token ditolak 400", async () => {
    const res = await post("/update-token", {}, KEY);
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).success).toBe(false);
  });

  test("GET /token-status mencerminkan state", async () => {
    state.tokenValid = true;
    let body = await jsonOf(await get("/token-status", KEY));
    expect(body.data.token_status).toBe("valid");

    state.tokenValid = false;
    body = await jsonOf(await get("/token-status", KEY));
    expect(body.data.token_status).toBe("invalid");
    state.tokenValid = true;
  });
});

describe("QRIS dinamis", () => {
  test("POST /create-qris membuat QR dan /qr/:id mengembalikan PNG", async () => {
    const res = await post("/create-qris", { amount: 25000 }, KEY);
    const body = await jsonOf(res);
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.amount).toBe(25000);
    expect(body.data.expires_in).toBe("15 menit");

    const id = body.data.qris_url.split("/qr/")[1];
    const qrRes = await get(`/qr/${id}`);
    expect(qrRes.status).toBe(200);
    expect(qrRes.headers.get("Content-Type")).toContain("image/png");
    // Magic number PNG: 89 50 4E 47 (‰PNG)
    const bytes = new Uint8Array(await qrRes.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  test("POST /create-qris dengan nominal tidak valid ditolak 400", async () => {
    for (const amount of [0, -5]) {
      const res = await post("/create-qris", { amount }, KEY);
      expect(res.status).toBe(400);
      expect((await jsonOf(res)).success).toBe(false);
    }
  });

  test("POST /create-qris menerima nominal sebagai string angka", async () => {
    const res = await post("/create-qris", { amount: "15000" }, KEY);
    const body = await jsonOf(res);
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.amount).toBe(15000);
  });
});

describe("check-payment (mock ShopeePay)", () => {
  const nowSec = () => Math.floor(Date.now() / 1000);

  test("pembayaran terdeteksi dari notifikasi real-time", async () => {
    mockNotifications([paymentNotif("2.786", "notif-tx-1", nowSec() - 10)]);
    const res = await post("/check-payment", { amount: 2786 }, KEY);
    const body = await jsonOf(res);
    expect(res.status).toBe(200);
    expect(body.paid).toBe(true);
    expect(body.source).toBe("notification");
    expect(body.transaction.transactionId).toBe("notif-tx-1");
    expect(body.transaction.amount).toBe(2786);
    expect(body.transaction.status).toBe("success");
  });

  test("notifikasi tanpa nominal cocok, fallback ke transaction list", async () => {
    mockNotifications([paymentNotif("1.000", "notif-tx-2", nowSec() - 10)]);
    mockShopee([
      { transactionId: "tx-list-fb", amount: "2.000", status: 3, createTime: nowSec() - 10 },
    ]);
    const res = await post("/check-payment", { amount: 2000 }, KEY);
    const body = await jsonOf(res);
    expect(res.status).toBe(200);
    expect(body.paid).toBe(true);
    expect(body.transaction.transactionId).toBe("tx-list-fb");
  });

  test("API notifikasi gagal, fallback ke transaction list tetap jalan", async () => {
    mockNotifications([], true);
    mockShopee([
      { transactionId: "tx-fallback", amount: "5.500", status: 3, createTime: nowSec() - 10 },
    ]);
    const res = await post("/check-payment", { amount: 5500 }, KEY);
    const body = await jsonOf(res);
    expect(res.status).toBe(200);
    expect(body.paid).toBe(true);
    expect(body.transaction.transactionId).toBe("tx-fallback");
  });

  test("notifikasi yang sudah diklaim tidak terklaim dua kali", async () => {
    mockNotifications([paymentNotif("3.000", "notif-claimed", nowSec() - 10)]);
    const first = await post("/check-payment", { amount: 3000 }, KEY);
    expect((await jsonOf(first)).paid).toBe(true);
    const second = await post("/check-payment", { amount: 3000 }, KEY);
    expect((await jsonOf(second)).paid).toBe(false);
  });

  test("notifikasi sebelum startTime diabaikan", async () => {
    mockNotifications([paymentNotif("4.000", "notif-old", nowSec() - 7200)]);
    const res = await post(
      "/check-payment",
      { amount: 4000, startTime: nowSec() - 60 },
      KEY,
    );
    const body = await jsonOf(res);
    expect(res.status).toBe(200);
    expect(body.paid).toBe(false);
  });

  test("transaksi cocok mengembalikan paid: true beserta issuer", async () => {
    mockShopee([
      { transactionId: "tx-paid-1", amount: "1.008", status: 3, createTime: nowSec() - 10 },
    ]);
    const res = await post("/check-payment", { amount: 1008 }, KEY);
    const body = await jsonOf(res);
    expect(res.status).toBe(200);
    expect(body.paid).toBe(true);
    expect(body.transaction.transactionId).toBe("tx-paid-1");
    expect(body.transaction.amount).toBe(1008);
    expect(body.transaction.status).toBe("success");
    expect(body.transaction.issuer).toBe("OVO");
  });

  test("transaksi yang sama tidak bisa diklaim dua kali (dedup)", async () => {
    mockShopee([
      { transactionId: "tx-paid-1", amount: "1.008", status: 3, createTime: nowSec() - 10 },
    ]);
    const res = await post("/check-payment", { amount: 1008 }, KEY);
    expect((await jsonOf(res)).paid).toBe(false);
  });

  test("nominal tidak cocok mengembalikan paid: false", async () => {
    mockShopee([
      { transactionId: "tx-other", amount: "5.000", status: 3, createTime: nowSec() - 10 },
    ]);
    const res = await post("/check-payment", { amount: 777 }, KEY);
    expect((await jsonOf(res)).paid).toBe(false);
  });

  test("transaksi pending/gagal tidak dianggap lunas", async () => {
    mockShopee([
      { transactionId: "tx-pending", amount: "2.000", status: 1, createTime: nowSec() - 10 },
      { transactionId: "tx-failed", amount: "2.000", status: 2, createTime: nowSec() - 10 },
    ]);
    const res = await post("/check-payment", { amount: 2000 }, KEY);
    expect((await jsonOf(res)).paid).toBe(false);
  });

  test("transaksi sebelum startTime diabaikan", async () => {
    mockShopee([
      { transactionId: "tx-old", amount: "3.000", status: 3, createTime: nowSec() - 7200 },
    ]);
    const res = await post(
      "/check-payment",
      { amount: 3000, startTime: nowSec() - 60 },
      KEY,
    );
    expect((await jsonOf(res)).paid).toBe(false);
  });

  test("error dari ShopeePay diteruskan sebagai 400", async () => {
    globalThis.fetch = asFetch(async () =>
      new Response(JSON.stringify({ code: 200020, msg: "invalid token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const res = await post("/check-payment", { amount: 1000 }, KEY);
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("invalid token");
  });
});

describe("notifications endpoint (mock ShopeePay)", () => {
  test("GET /notifications memformat notifikasi pembayaran", async () => {
    mockNotifications([
      paymentNotif("2.786", "notif-list-1", 1790759376),
      {
        actionId: "act-other",
        title: "Payout diproses",
        content: "Payout <b>Rp1.000.000</b> telah diproses.",
        createTime: 1790759000,
        actionType: 1300,
        unreadStatus: 1,
        pcRedirectUrl: "https://partner.shopee.co.id/payout",
      },
    ]);
    const res = await get("/notifications", KEY);
    const body = await jsonOf(res);
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.notifications).toHaveLength(2);
    expect(body.data.notifications[0].payment).toEqual({
      transactionId: "notif-list-1",
      amount: 2786,
    });
    expect(body.data.notifications[1].payment).toBeNull();
    expect(body.data.next_cursor).toBe("999");
  });

  test("GET /notifications meneruskan error API sebagai 400", async () => {
    mockNotifications([], true);
    const res = await get("/notifications", KEY);
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).success).toBe(false);
  });
});

describe("transactions (mock ShopeePay)", () => {
  test("GET /transactions memformat mutasi dengan benar", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    mockShopee([
      { transactionId: "tx-list-1", amount: "9.600", status: 3, createTime: nowSec },
    ]);
    const res = await get("/transactions", KEY);
    const body = await jsonOf(res);
    expect(res.status).toBe(200);
    expect(body.total_amount).toBe("1.008");
    expect(body.data.transactions).toHaveLength(1);
    expect(body.data.transactions[0].amount).toBe(9600);
    expect(body.data.transactions[0].status).toBe("success");
    expect(body.data.transactions[0].issuer).toBe("OVO");
  });

  test("header X-Shopee-Token diteruskan ke API ShopeePay", async () => {
    let seenToken = "";
    globalThis.fetch = asFetch(async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      seenToken = payload.data.metadata.token;
      return new Response(
        JSON.stringify({ code: 0, data: { list: [], totalNetSales: "0" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    await app.handle(
      new Request(BASE + "/transactions", {
        headers: { "X-API-Key": KEY, "X-Shopee-Token": "B:multi-store-token" },
      }),
    );
    expect(seenToken).toBe("B:multi-store-token");
  });
});

describe("logs", () => {
  test("GET /api/logs mengembalikan array log", async () => {
    const res = await get("/api/logs", KEY);
    const body = await jsonOf(res);
    expect(res.status).toBe(200);
    expect(Array.isArray(body.data.logs)).toBe(true);
  });
});
