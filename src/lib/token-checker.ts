import { state } from "../config";
import { logEvent } from "./logger";
import { callShopeeAPI } from "./shopee";
import { sendTelegramNotif } from "./telegram";

async function notifyTokenProblem(reason: string) {
  if (state.tokenNotifSent) return;
  await sendTelegramNotif(
    `⚠️ <b>Shopee API</b>\n\nToken invalid: ${reason}\n\nUpdate token via POST /update-token`,
  );
  state.tokenNotifSent = true;
}

export async function checkToken() {
  const now = Math.floor(Date.now() / 1000);
  try {
    const result = await callShopeeAPI(now - 3600, now, 1, "");
    if (!result || result.code !== 0) {
      const msg = result?.msg ?? "Invalid response format";
      logEvent("ERROR", `Token invalid: ${msg}`);
      state.tokenValid = false;
      await notifyTokenProblem(msg);
      return;
    }
    logEvent("INFO", "Token valid");
    state.tokenValid = true;
    state.tokenNotifSent = false;
  } catch (err) {
    const msg = (err as Error).message;
    logEvent("ERROR", `Token check failed: ${msg}`);
    state.tokenValid = false;
    await notifyTokenProblem(msg);
  }
}

export function startTokenChecker() {
  void checkToken();
  setInterval(checkToken, 5 * 60 * 1000).unref();
}
