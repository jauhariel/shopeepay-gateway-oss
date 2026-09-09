import { describe, expect, test } from "bun:test";
import {
  parseTLV,
  buildTLV,
  crc16CCITT,
  generateDynamicQRIS,
} from "../src/lib/qris";

const STATIC_QRIS = process.env.QRIS_STATIC!;

describe("parseTLV / buildTLV", () => {
  test("roundtrip: build(parse(x)) === x untuk payload valid", () => {
    const fields = parseTLV(STATIC_QRIS);
    expect(fields.length).toBeGreaterThan(0);
    expect(buildTLV(fields)).toBe(STATIC_QRIS);
  });

  test("membaca tag dan value dengan benar", () => {
    const fields = parseTLV(STATIC_QRIS);
    const map = new Map(fields);
    expect(map.get("00")).toBe("01"); // Payload Format Indicator
    expect(map.get("53")).toBe("360"); // Currency IDR
    expect(map.get("58")).toBe("ID"); // Country
  });

  test("berhenti dengan aman pada data korup", () => {
    expect(parseTLV("0002")).toEqual([]);
    expect(parseTLV("")).toEqual([]);
  });
});

describe("crc16CCITT", () => {
  test("menghasilkan 4 digit hex uppercase", () => {
    const crc = crc16CCITT("000201010211");
    expect(crc).toMatch(/^[0-9A-F]{4}$/);
  });

  test("deterministik dan sensitif terhadap perubahan input", () => {
    const a = crc16CCITT("hello");
    expect(crc16CCITT("hello")).toBe(a);
    expect(crc16CCITT("hellp")).not.toBe(a);
  });
});

describe("generateDynamicQRIS", () => {
  test("menyuntikkan Tag 54 (nominal) setelah Tag 53", () => {
    const out = generateDynamicQRIS(STATIC_QRIS, 15000);
    const map = new Map(parseTLV(out));
    expect(map.get("54")).toBe("15000");
    // Tag 54 harus muncul tepat setelah Tag 53
    const tags = parseTLV(out).map(([tag]) => tag);
    expect(tags.indexOf("54")).toBe(tags.indexOf("53") + 1);
  });

  test("CRC (Tag 63) dihitung ulang dengan benar", () => {
    const out = generateDynamicQRIS(STATIC_QRIS, 15000);
    const withoutCrc = out.slice(0, -4); // buang 4 digit CRC
    expect(withoutCrc.endsWith("6304")).toBe(true);
    expect(out.slice(-4)).toBe(crc16CCITT(withoutCrc));
  });

  test("mengganti Tag 54 yang sudah ada, bukan menambah duplikat", () => {
    const withAmount = generateDynamicQRIS(STATIC_QRIS, 5000);
    const regenerated = generateDynamicQRIS(withAmount, 99000);
    const amounts = parseTLV(regenerated).filter(([tag]) => tag === "54");
    expect(amounts).toEqual([["54", "99000"]]);
  });

  test("melempar error jika QRIS kosong atau tidak valid", () => {
    expect(() => generateDynamicQRIS("", 1000)).toThrow("QRIS_STATIC");
    expect(() => generateDynamicQRIS("bukan-qris", 1000)).toThrow();
  });
});
