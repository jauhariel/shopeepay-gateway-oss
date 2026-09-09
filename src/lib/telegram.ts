import { config } from "../config";
import { logEvent } from "./logger";

export async function sendTelegramNotif(message: string) {
  if (!config.telegramBotToken || !config.telegramChatId) {
    logEvent("WARN", "[TELEGRAM] Bot token atau chat ID belum diset");
    return;
  }

  try {
    await fetch(
      `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: config.telegramChatId,
          text: message,
          parse_mode: "HTML",
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    logEvent("INFO", "[TELEGRAM] Notif terkirim");
  } catch (err) {
    logEvent("ERROR", `[TELEGRAM] Gagal kirim: ${(err as Error).message}`);
  }
}
