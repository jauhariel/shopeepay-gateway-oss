import { app } from "./app";
import { config, state } from "./config";
import { startTokenChecker } from "./lib/token-checker";

app.listen(config.port);

console.log(`ShopeePay Gateway OSS (Bun + Elysia) running at http://localhost:${app.server?.port}`);
console.log("Endpoints:");
console.log("  GET  /                   - Status banner");
console.log("  GET  /api/health         - Health check");
console.log("  POST /update-token       - Update ShopeeToken");
console.log("  GET  /token-status       - Check ShopeeToken validity");
console.log("  POST /create-qris        - Generate dynamic QRIS");
console.log("  GET  /qr/:id             - QR image redirect (public)");
console.log("  GET  /transactions       - Latest transactions");
console.log("  GET  /transactions/all   - Full month transactions");
console.log("  POST /check-payment      - Stateless payment verification");
console.log("  GET  /api/logs           - In-memory logs");

if (state.shopeeToken && config.apiKey) {
  startTokenChecker();
} else {
  console.warn("WARNING: SHOPEE_TOKEN dan API_KEY harus diset di .env untuk menjalankan pengecekan token.");
}
