import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import QRCode from "qrcode";
import { config, state } from "./config";
import { logEvent, getLogs } from "./lib/logger";
import { generateDynamicQRIS } from "./lib/qris";
import {
  callShopeeAPI,
  callShopeeDetailAPI,
  callShopeeNotificationAPI,
  formatTransaction,
  parseAmount,
  parsePaymentNotification,
  toWIB,
  type ShopeeTransaction,
} from "./lib/shopee";
import { claim, isClaimed } from "./lib/dedup";

const getReqToken = (headers: Headers) =>
  headers.get("x-shopee-token") || state.shopeeToken;

/** Ambil issuer (metode pembayaran asal) dari detail transaksi. */
async function resolveIssuer(t: ShopeeTransaction, token: string) {
  try {
    const detail = await callShopeeDetailAPI(
      t.displayTransactionId || t.transactionId,
      token,
    );
    if (detail?.code === 0 && detail.data?.issuer) return detail.data.issuer;
  } catch (err) {
    logEvent("WARN", `Gagal mengambil detail ${t.transactionId}: ${(err as Error).message}`);
  }
  return undefined;
}

// ── Routes terproteksi (wajib X-API-Key header atau ?api_key=) ───────────────
const protectedRoutes = new Elysia()
  .onBeforeHandle(({ request, query, set }) => {
    const key =
      request.headers.get("x-api-key") ??
      (query as Record<string, string | undefined>).api_key;
    if (!key || key !== config.apiKey) {
      set.status = 401;
      return { success: false, error: "Invalid or missing API key" };
    }
  })

  .post("/update-token", ({ body }) => {
    state.shopeeToken = body.token;
    logEvent("INFO", "Token updated via API");
    return { success: true, data: { message: "Token updated" } };
  }, {
    body: t.Object({ token: t.String({ minLength: 1 }) }),
  })

  .get("/token-status", () => ({
    success: state.tokenValid,
    data: {
      token_status: state.tokenValid ? "valid" : "invalid",
      message: state.tokenValid
        ? "Token is working"
        : "Token expired/invalid. Please update via POST /update-token",
    },
  }))

  .post("/create-qris", ({ body, request, set }) => {
    try {
      const qris = generateDynamicQRIS(config.qrisStatic, body.amount);
      const id = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
      const expiresAt = Date.now() + 15 * 60 * 1000;
      state.qrisStore.set(id, { data: qris, expiresAt });

      const proto =
        request.headers.get("x-forwarded-proto") ??
        new URL(request.url).protocol.replace(":", "");
      const host = request.headers.get("host") ?? `localhost:${config.port}`;

      return {
        success: true,
        data: {
          qris_url: `${proto}://${host}/qr/${id}`,
          amount: body.amount,
          expires_at: toWIB(new Date(expiresAt)),
          expires_in: "15 menit",
        },
      };
    } catch (err) {
      set.status = 500;
      return { success: false, error: (err as Error).message };
    }
  }, {
    // Numeric: terima number maupun string angka ("15000") seperti versi Express lama
    body: t.Object({ amount: t.Numeric({ minimum: 1 }) }),
  })

  .get("/transactions", async ({ query, request, set }) => {
    const now = Math.floor(Date.now() / 1000);
    const startTime = Number(query.startTime) || now - 3 * 24 * 3600;
    const endTime = Number(query.endTime) || now;
    const pageSize = Number(query.pageSize) || 10;
    const nextPos = query.next_position || "";
    const reqToken = getReqToken(request.headers);

    try {
      const result = await callShopeeAPI(startTime, endTime, pageSize, nextPos, reqToken);
      if (!result) {
        set.status = 500;
        return { success: false, error: "Empty response from ShopeePay API" };
      }
      if (result.code !== 0) {
        set.status = 400;
        return { success: false, error: result.msg || `API error code ${result.code}` };
      }

      const list = result.data?.list ?? [];
      const transactions = [];
      for (const t of list) {
        const trx = formatTransaction(t);
        const issuer = await resolveIssuer(t, reqToken);
        transactions.push(issuer ? { ...trx, issuer } : trx);
      }

      return {
        success: true,
        total_amount: result.data?.totalNetSales || "0",
        data: { transactions },
      };
    } catch (err) {
      set.status = 500;
      return { success: false, error: (err as Error).message };
    }
  }, {
    query: t.Object({
      startTime: t.Optional(t.Numeric()),
      endTime: t.Optional(t.Numeric()),
      pageSize: t.Optional(t.Numeric()),
      next_position: t.Optional(t.String()),
      api_key: t.Optional(t.String()),
    }),
  })

  .get("/transactions/all", async ({ request, set }) => {
    const now = new Date();
    const startOfMonth = new Date(
      Date.UTC(now.getFullYear(), now.getMonth(), 1) - 7 * 60 * 60 * 1000,
    );
    const startTime = Math.floor(startOfMonth.getTime() / 1000);
    const endTime = Math.floor(now.getTime() / 1000);
    const pageSize = 100;
    const reqToken = getReqToken(request.headers);

    const allTrx = [];
    let nextPos = "";

    try {
      for (;;) {
        const result = await callShopeeAPI(startTime, endTime, pageSize, nextPos, reqToken);
        if (!result) {
          set.status = 500;
          return { success: false, error: "Empty response from ShopeePay API" };
        }
        if (result.code !== 0) {
          set.status = 400;
          return { success: false, error: result.msg || `API error code ${result.code}` };
        }

        const list = result.data?.list ?? [];
        for (const t of list) {
          const trx = formatTransaction(t);
          const issuer = await resolveIssuer(t, reqToken);
          allTrx.push(issuer ? { ...trx, issuer } : trx);
        }

        if (!result.data?.next_position || list.length < pageSize) break;
        nextPos = result.data.next_position;
        await Bun.sleep(500); // jeda rate-limit antar halaman
      }

      const pad = (n: number) => String(n).padStart(2, "0");
      const toDate = (d: Date) => {
        const w = new Date(d.getTime() + 7 * 60 * 60 * 1000);
        return `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}`;
      };

      return {
        success: true,
        total_amount: String(allTrx.length),
        data: {
          period: `${toDate(startOfMonth)} s/d ${toDate(now)}`,
          total_count: allTrx.length,
          transactions: allTrx,
        },
      };
    } catch (err) {
      set.status = 500;
      return { success: false, error: (err as Error).message };
    }
  })

  .get("/notifications", async ({ query, request, set }) => {
    const cursor = query.cursor || 0;
    const limit = Number(query.limit) || 20;
    const reqToken = getReqToken(request.headers);

    try {
      const result = await callShopeeNotificationAPI(cursor, limit, reqToken);
      if (!result || result.code) {
        set.status = 400;
        return {
          success: false,
          error: result?.msg || `Notification API error ${result?.code ?? "unknown"}`,
        };
      }

      const notifications = [];
      for (const n of result.data?.list ?? []) {
        const payment = parsePaymentNotification(n);
        notifications.push({
          id: n.actionId,
          title: n.title,
          content: n.content,
          time: toWIB(new Date(n.createTime * 1000)),
          unread: n.unreadStatus === 1,
          payment: payment
            ? { transactionId: payment.transactionId, amount: payment.amount }
            : null,
        });
      }

      return {
        success: true,
        data: {
          notifications,
          next_cursor: result.data?.cursor ?? null,
        },
      };
    } catch (err) {
      set.status = 500;
      return { success: false, error: (err as Error).message };
    }
  }, {
    query: t.Object({
      cursor: t.Optional(t.String()),
      limit: t.Optional(t.Numeric()),
      api_key: t.Optional(t.String()),
    }),
  })

  .post("/check-payment", async ({ body, request, set }) => {
    const { amount } = body;
    const reqToken = getReqToken(request.headers);
    const nowUnix = Math.floor(Date.now() / 1000);
    const startUnix = Number(body.startTime) || nowUnix - 30 * 60;

    logEvent(
      "INFO",
      `Cek pembayaran stateless. Nominal: Rp ${amount}, mulai: ${new Date(startUnix * 1000).toISOString()}`,
    );

    try {
      // ── Sumber 1: notifikasi partner portal (real-time, tanpa delay indexing) ──
      try {
        const notif = await callShopeeNotificationAPI(0, 30, reqToken);
        const notifList = notif.data?.list ?? [];
        const match = notifList
          .map(parsePaymentNotification)
          .find((p) => p !== null && p.amount === amount && p.createTime >= startUnix);

        if (match) {
          const transactionId = match.transactionId;

          // Anti double-claim: abaikan transaksi yang sudah pernah diklaim (24 jam)
          if (isClaimed(transactionId)) {
            logEvent("WARN", `Transaksi ${transactionId} sudah pernah diklaim, diabaikan.`);
            return { success: true, paid: false };
          }

          claim(transactionId);
          logEvent("INFO", `Pembayaran lunas via notifikasi (${transactionId}).`);

          return {
            success: true,
            paid: true,
            source: "notification",
            transaction: {
              transactionId,
              amount: match.amount,
              status: "success",
              time: toWIB(new Date(match.createTime * 1000)),
              issuer: "QRIS / ShopeePay",
            },
          };
        }
      } catch (err) {
        logEvent("WARN", `Sumber notifikasi gagal, fallback ke transaction list: ${(err as Error).message}`);
      }

      // ── Sumber 2 (fallback): get-transaction-list ─────────────────────────────
      const result = await callShopeeAPI(startUnix, nowUnix, 50, "", reqToken);
      if (!result) {
        set.status = 500;
        return { success: false, error: "Empty response from ShopeePay API" };
      }
      if (result.code !== 0) {
        set.status = 400;
        return { success: false, error: result.msg || `API error code ${result.code}` };
      }

      const list = result.data?.list ?? [];
      const match = list.find(
        (tx) =>
          tx.status === 3 &&
          parseAmount(tx.amount) === amount &&
          tx.createTime >= startUnix,
      );

      if (!match) {
        logEvent("INFO", `Nominal Rp ${amount} BELUM ditemukan.`);
        return { success: true, paid: false };
      }

      const transactionId = match.transactionId || match.displayTransactionId || "";

      // Anti double-claim: abaikan transaksi yang sudah pernah diklaim (24 jam)
      if (isClaimed(transactionId)) {
        logEvent("WARN", `Transaksi ${transactionId} sudah pernah diklaim, diabaikan.`);
        return { success: true, paid: false };
      }

      const trx = formatTransaction(match);
      const issuer = await resolveIssuer(match, reqToken);
      claim(transactionId);

      logEvent("INFO", `Pembayaran lunas via ${issuer ?? "ShopeePay/QRIS"} (${transactionId}).`);

      return {
        success: true,
        paid: true,
        transaction: {
          transactionId,
          amount: trx.amount,
          status: trx.status,
          time: trx.time,
          issuer: issuer ?? "QRIS / ShopeePay",
        },
      };
    } catch (err) {
      logEvent("ERROR", `Pengecekan gagal: ${(err as Error).message}`);
      set.status = 500;
      return { success: false, error: (err as Error).message };
    }
  }, {
    body: t.Object({
      amount: t.Numeric({ minimum: 1 }),
      startTime: t.Optional(t.Numeric()),
    }),
  })

  .get("/api/logs", () => ({ success: true, data: { logs: getLogs() } }));

// ── App utama (tanpa listen, agar bisa dipakai di test) ──────────────────────
export const app = new Elysia()
  .use(cors({ origin: true, credentials: true }))

  // Normalisasi error validasi TypeBox agar kontrak respon konsisten
  .onError(({ code, error, set }) => {
    if (code === "VALIDATION") {
      set.status = 400;
      let message = "Invalid request parameters";
      try {
        message = JSON.parse(error.message).summary ?? message;
      } catch {}
      return { success: false, error: message };
    }
  })

  .get("/", () => "Shoppe API Running")

  .get("/api/health", () => ({
    success: true,
    message: "ShopeePay API Service is running",
    timestamp: new Date().toISOString(),
  }))

  // Publik: render gambar QR langsung di server (untuk ditampilkan ke pelanggan)
  .get("/qr/:id", async ({ params, set }) => {
    const entry = state.qrisStore.get(params.id);
    if (!entry) {
      set.status = 404;
      return "QR not found";
    }
    if (Date.now() > entry.expiresAt) {
      state.qrisStore.delete(params.id);
      set.status = 410;
      return "QR expired";
    }
    try {
      const png = await QRCode.toBuffer(entry.data, { width: 300, margin: 2 });
      set.headers["Content-Type"] = "image/png";
      set.headers["Cache-Control"] = "no-store";
      return new Uint8Array(png);
    } catch (err) {
      set.status = 500;
      return { success: false, error: (err as Error).message };
    }
  })

  .use(protectedRoutes);
