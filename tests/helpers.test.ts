import { describe, expect, test } from "bun:test";
import { parseAmount, formatTransaction, toWIB, parsePaymentNotification } from "../src/lib/shopee";
import { claim, isClaimed } from "../src/lib/dedup";
import { logEvent, getLogs } from "../src/lib/logger";

describe("parseAmount", () => {
  test("membersihkan pemisah ribuan titik dan koma", () => {
    expect(parseAmount("10.000")).toBe(10000);
    expect(parseAmount("1,008")).toBe(1008);
    expect(parseAmount("409.662")).toBe(409662);
  });

  test("angka number dan string biasa tetap benar", () => {
    expect(parseAmount(15000)).toBe(15000);
    expect(parseAmount("9600")).toBe(9600);
  });

  test("input aneh menjadi 0", () => {
    expect(parseAmount(undefined)).toBe(0);
    expect(parseAmount("abc")).toBe(0);
    expect(parseAmount("")).toBe(0);
  });
});

describe("formatTransaction & toWIB", () => {
  test("epoch 0 menjadi 1970-01-01 07:00:00 WIB", () => {
    expect(toWIB(new Date(0))).toBe("1970-01-01 07:00:00");
  });

  test("memetakan status numerik ke string", () => {
    const base = { transactionId: "x", amount: "1000", createTime: 0 };
    expect(formatTransaction({ ...base, status: 1 }).status).toBe("pending");
    expect(formatTransaction({ ...base, status: 2 }).status).toBe("failed");
    expect(formatTransaction({ ...base, status: 3 }).status).toBe("success");
    expect(formatTransaction({ ...base, status: 4 }).status).toBe("refunded");
    expect(formatTransaction({ ...base, status: 5 }).status).toBe("expired");
    expect(formatTransaction({ ...base, status: 99 }).status).toBe("unknown_99");
  });

  test("output lengkap berisi amount, status, time", () => {
    const trx = formatTransaction({
      transactionId: "x",
      amount: "1.008",
      status: 3,
      createTime: 0,
    });
    expect(trx).toEqual({
      amount: 1008,
      status: "success",
      time: "1970-01-01 07:00:00",
    });
  });
});

describe("parsePaymentNotification", () => {
  const base = {
    actionId: "act-1",
    content: "A payment of <b>Rp2.786</b> has been received. Ref: <b>103230502239354928</b>.",
    createTime: 1790759376,
    actionType: 1219,
    unreadStatus: 1,
    pcRedirectUrl:
      "https://partner.shopee.co.id/transactions?transactionId=103230502239354928&utm_medium=notification",
  };

  test("notifikasi pembayaran diparse jadi transaksi", () => {
    const p = parsePaymentNotification({
      ...base,
      title: "Payment of Rp2.786 received",
    });
    expect(p).not.toBeNull();
    expect(p!.transactionId).toBe("103230502239354928");
    expect(p!.amount).toBe(2786);
    expect(p!.createTime).toBe(1790759376);
    expect(p!.source).toBe("notification");
  });

  test("nominal dengan pemisah ribuan diparse benar", () => {
    const p = parsePaymentNotification({
      ...base,
      title: "Pembayaran sebesar Rp1.234.567 diterima",
    });
    expect(p!.amount).toBe(1234567);
  });

  test("bukan notifikasi pembayaran (actionType lain) -> null", () => {
    expect(parsePaymentNotification({ ...base, title: "Payout diproses", actionType: 1300 })).toBeNull();
  });

  test("tanpa transactionId di URL -> null", () => {
    expect(
      parsePaymentNotification({ ...base, title: "Payment of Rp100 received", pcRedirectUrl: "https://partner.shopee.co.id/x" }),
    ).toBeNull();
  });
});

describe("dedup (anti double-claim)", () => {
  test("id yang belum diklaim mengembalikan false", () => {
    expect(isClaimed("tx-belum-ada")).toBe(false);
  });

  test("id yang sudah diklaim mengembalikan true", () => {
    claim("tx-123");
    expect(isClaimed("tx-123")).toBe(true);
  });
});

describe("logger", () => {
  test("menyimpan log dan bisa dibaca kembali", () => {
    const before = getLogs().length;
    logEvent("INFO", "pesan-test-logger");
    const logs = getLogs();
    expect(logs.length).toBe(before + 1);
    expect(logs.at(-1)?.message).toBe("pesan-test-logger");
    expect(logs.at(-1)?.level).toBe("INFO");
  });
});
