type TlvField = [tag: string, value: string];

function parseTLV(data: string): TlvField[] {
  const result: TlvField[] = [];
  let i = 0;
  while (i < data.length) {
    if (i + 4 > data.length) break;
    const tag = data.slice(i, i + 2);
    const length = parseInt(data.slice(i + 2, i + 4), 10);
    if (Number.isNaN(length)) break;
    i += 4;
    if (i + length > data.length) break;
    result.push([tag, data.slice(i, i + length)]);
    i += length;
  }
  return result;
}

function buildTLV(fields: TlvField[]): string {
  let res = "";
  for (const [tag, val] of fields) {
    res += tag + String(val.length).padStart(2, "0") + val;
  }
  return res;
}

function crc16CCITT(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Menyuntikkan nominal (Tag 54) ke QRIS statis EMVCo dan
 * menghitung ulang CRC16-CCITT (Tag 63).
 */
export function generateDynamicQRIS(staticQRIS: string, amount: number): string {
  if (!staticQRIS) throw new Error("QRIS_STATIC belum diset di .env");

  const fields = parseTLV(staticQRIS);
  if (fields.length === 0) throw new Error("invalid QRIS format");

  const newFields: TlvField[] = [];
  let hasAmount = false;
  for (const [tag, val] of fields) {
    if (tag === "63") continue; // CRC dihitung ulang
    if (tag === "54") {
      newFields.push(["54", String(amount)]);
      hasAmount = true;
      continue;
    }
    newFields.push([tag, val]);
  }

  if (!hasAmount) {
    const withAmount: TlvField[] = [];
    for (const f of newFields) {
      withAmount.push(f);
      if (f[0] === "53") withAmount.push(["54", String(amount)]);
    }
    newFields.length = 0;
    newFields.push(...withAmount);
  }

  const qrisWithoutCRC = buildTLV(newFields) + "6304";
  return qrisWithoutCRC + crc16CCITT(qrisWithoutCRC);
}
