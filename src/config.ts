export const config = {
  port: Number(Bun.env.PORT ?? 4000),
  apiKey: Bun.env.API_KEY ?? "",
  telegramBotToken: Bun.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: Bun.env.TELEGRAM_CHAT_ID ?? "",
  qrisStatic: Bun.env.QRIS_STATIC ?? "",
} as const;

/** Mutable runtime state (100% stateless — semua disimpan di RAM). */
export const state = {
  shopeeToken: Bun.env.SHOPEE_TOKEN ?? "",
  tokenValid: true,
  tokenNotifSent: false,
  /** id -> { data, expiresAt } untuk QRIS dinamis yang sudah dibuat */
  qrisStore: new Map<string, { data: string; expiresAt: number }>(),
};
