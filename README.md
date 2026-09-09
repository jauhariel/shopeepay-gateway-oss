# 🚀 ShopeePay Gateway OSS (Unofficial)

[![Bun](https://img.shields.io/badge/Bun-%3E%3D%201.4-black.svg?style=for-the-badge&logo=bun&logoColor=white)](https://bun.sh)
[![ElysiaJS](https://img.shields.io/badge/ElysiaJS-1.4-orange.svg?style=for-the-badge)](https://elysiajs.com)
[![Stateless](https://img.shields.io/badge/Architecture-100%25%20Stateless-brightgreen.svg?style=for-the-badge)](https://en.wikipedia.org/wiki/Stateless_protocol)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

API Gateway **open source**, ringan, dan **100% Stateless (tanpa database & tanpa background polling)** untuk verifikasi mutasi transaksi ShopeePay Partner, validasi token, penarikan riwayat bulanan, dan pembuatan **dynamic QRIS EMVCo** secara instan. Dibangun di atas **Bun + ElysiaJS** dengan TypeScript penuh.

---

> [!IMPORTANT]
> ### ⚠️ Disclaimer: Unofficial Gateway
>
> Proyek ini adalah **Unofficial API Gateway** yang **TIDAK berafiliasi, TIDAK didukung, dan TIDAK disetujui secara resmi oleh PT. Shopee International Indonesia atau Sea Group** dalam kapasitas apapun.
>
> Gateway ini bekerja dengan cara membaca data dari **ShopeePay Partner Portal** secara teknis menggunakan sesi akun merchant kamu sendiri (token internal), serupa dengan cara kerja extension browser atau skrip otomasi pihak ketiga.
>
> * ✅ **Tidak ada credential yang keluar** — token & API key disimpan di `.env` di server kamu sendiri dan tidak pernah dikirim ke pihak lain selain server resmi ShopeePay Partner.
> * ✅ **Read-Only & Non-Destruktif** — hanya membaca data mutasi; tidak mengubah saldo, menarik dana, atau memodifikasi akun.
> * ✅ **Zero Third-Party** — semua lalu lintas data berjalan langsung dari server kamu ke `shopeepay.shopee.co.id`.
>
> **Penggunaan sepenuhnya menjadi tanggung jawab pengguna.** Pastikan kamu memahami Syarat & Ketentuan ShopeePay Partner yang berlaku sebelum menggunakannya di lingkungan produksi komersial.

---

## 🎯 Fitur Utama

* **Zero-Database (100% Stateless)** — aman di-deploy di platform serverless gratis (Render, Railway, dll) tanpa takut kehilangan data saat restart.
* **Dynamic QRIS EMVCo Injector** — parsing TLV (*Tag-Length-Value*) pada QRIS statis, injeksi nominal (Tag `54`), dan hitung ulang **CRC16-CCITT** secara in-memory.
* **Smart API Polling (Anti-Block)** — gateway hanya memanggil API ShopeePay saat dipicu request dari toko kamu; saat sepi, request = 0.
* **Dynamic Multi-Token** — dukung multi-akun merchant via header `X-Shopee-Token` per request.
* **Automatic Issuer Resolution** — deteksi metode pembayaran asal pengirim (Seabank, OVO, DANA, BCA, dll).
* **Live Token Validator + Alert Telegram** — uji token tiap 5 menit; jika mati, notifikasi dikirim ke Bot Telegram.
* **In-Memory Deduplication (Anti Double-Claim)** — `transactionId` yang sukses diklaim dicatat di RAM selama 24 jam untuk mencegah klaim ganda pada nominal kembar.
* **In-Memory Circular Logs** — 100 log terakhir di RAM, dapat diakses via `/api/logs`.

---

## 🛠️ Instalasi & Menjalankan

Prasyarat: [Bun](https://bun.sh) >= 1.4.

```bash
git clone https://github.com/jauhariel/shopeepay-gateway-oss.git
cd shopeepay-gateway-oss
bun install
cp .env.example .env   # lalu isi nilainya
bun run dev            # development (hot reload)
bun run start          # production
bun run typecheck      # cek tipe TypeScript
bun test               # jalankan test suite (40 test: unit + integrasi)
```

Test memakai runner bawaan Bun — tanpa dependency tambahan. Environment test di-set otomatis lewat `bunfig.toml` → `tests/preload.ts`, dan panggilan ke API ShopeePay di-mock sehingga test berjalan offline.

## ⚙️ Konfigurasi Environment (`.env`)

```env
SHOPEE_TOKEN="B:EWznmVDI//rF3y6Pt0XB3C3sQoKdsA3yxfPmGBHyUE..."   # token internal merchant (diawali 'B:')
API_KEY="secret-key-pilihanmu"                                  # proteksi gateway kamu sendiri
PORT=4000
TELEGRAM_BOT_TOKEN="8831336691:AAGoLvhhhy3gEq..."               # opsional
TELEGRAM_CHAT_ID="1265481161"                                   # opsional
QRIS_STATIC="00020101021126610016ID.CO.SHOPEE.WWW0118..."       # QRIS statis merchant
```

### 📋 Cara Mengambil `SHOPEE_TOKEN`

1. Login ke [ShopeePay Partner Portal](https://partner.shopee.co.id/) di browser.
2. Buka **Developer Tools** (`F12`) → tab **Network** → filter **Fetch/XHR**.
3. Refresh halaman transaksi, cari request bernama `get-transaction-list`.
4. Lihat **Request Payload** → `data` → `metadata` → `token`.
5. Salin nilai token (biasanya diawali `B:`) sebagai `SHOPEE_TOKEN`.

---

## 📑 Referensi API

Endpoint terproteksi mewajibkan header `X-API-Key: <API_KEY>` atau query `?api_key=<API_KEY>`.

| Method | Endpoint | Auth | Deskripsi |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Tidak | Banner status (`Shoppe API Running`) |
| `GET` | `/api/health` | Tidak | Health check |
| `POST` | `/update-token` | ✅ | Perbarui Shopee token in-memory — body: `{ "token": "B:..." }` |
| `GET` | `/token-status` | ✅ | Status validitas token saat ini |
| `POST` | `/create-qris` | ✅ | Generate QRIS dinamis — body: `{ "amount": 15000 }` |
| `GET` | `/qr/:id` | Tidak | Gambar QR dalam format PNG, dirender langsung di server (untuk pelanggan) |
| `GET` | `/transactions` | ✅ | Mutasi terbaru — query: `startTime`, `endTime`, `pageSize`, `next_position` |
| `GET` | `/transactions/all` | ✅ | Semua mutasi bulan berjalan (auto-paginasi) |
| `POST` | `/check-payment` | ✅ | Verifikasi pembayaran stateless — body: `{ "amount": 1008, "startTime": 1784050000 }` |
| `GET` | `/api/logs` | ✅ | 100 log terakhir (in-memory) |

Header opsional `X-Shopee-Token: B:...` dapat dikirim pada endpoint pembacaan data untuk merutekan request ke akun merchant lain (multi-store).

### Contoh respon `POST /check-payment` (terbayar)

```json
{
  "success": true,
  "paid": true,
  "transaction": {
    "transactionId": "264693445089687719",
    "amount": 1008,
    "status": "success",
    "time": "2026-07-15 00:42:21",
    "issuer": "Seabank"
  }
}
```

---

## 🛡️ Penanganan Kolisi Nominal Kembar

Karena gateway stateless, dua pelanggan dengan nominal sama persis berisiko *double claim*. Pengaman ganda yang disarankan:

1. **Deduplikasi di gateway** — `transactionId` yang sukses diklaim disimpan di RAM 24 jam; klaim ulang otomatis diabaikan (`paid: false`).
2. **Di aplikasi toko** — tambahkan kode unik (Rp 1–99) pada nominal, dan simpan `transactionId` yang pernah sukses di database toko sebagai pengaman kedua.

---

## 🚀 Deployment (24 Jam di VPS)

### Persiapan (semua opsi)

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Upload project & isi env
cd /opt/shopeepay-gateway-oss
bun install
cp .env.example .env
nano .env   # isi SHOPEE_TOKEN, API_KEY, QRIS_STATIC asli
```

### Opsi A: systemd (paling ringan, tanpa Node sama sekali)

```bash
sudo nano /etc/systemd/system/shopeepay-gateway.service
```

```ini
[Unit]
Description=ShopeePay Gateway OSS
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/shopeepay-gateway-oss
ExecStart=/root/.bun/bin/bun run src/index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now shopeepay-gateway   # jalan sekarang + otomatis saat reboot
sudo systemctl status shopeepay-gateway
journalctl -u shopeepay-gateway -f              # pantau log live
```

### Opsi B: PM2 (perlu Node untuk menjalankan PM2-nya saja)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

cd /opt/shopeepay-gateway-oss
pm2 start "bun run src/index.ts" --name shopeepay-gateway

# atau via single binary (PM2 tidak perlu tahu soal Bun):
bun build --compile src/index.ts --outfile server
pm2 start ./server --name shopeepay-gateway

pm2 startup   # jalankan perintah yang muncul agar auto-start saat reboot
pm2 save
```

Perintah operasional: `pm2 status`, `pm2 logs shopeepay-gateway`, `pm2 restart shopeepay-gateway`, `pm2 monit`.

### Opsi C: Platform PaaS (Railway / Render)

Set build command `bun install` dan start command `bun run start`, lalu isi semua environment variable sesuai `.env.example`.

### HTTPS (direkomendasikan untuk produksi)

Pasang Nginx reverse proxy + SSL gratis (Certbot), arahkan `proxy_pass` ke `http://localhost:4000`. HTTPS penting karena `X-API-Key` dan token ikut terkirim di setiap request.

> **Catatan stateless:** restart tidak menghilangkan data apa pun kecuali memori dedup 24 jam — selalu terapkan dedup kedua di database toko kamu (lihat bagian Penanganan Kolisi).

---

## 🗂️ Struktur Proyek

```
src/
├── index.ts            # Entry point: listen + token checker
├── app.ts              # Definisi app Elysia & seluruh route (dipakai juga oleh test)
├── config.ts           # Konfigurasi env & runtime state
└── lib/
    ├── shopee.ts       # HTTP client ShopeePay Partner API (fetch native)
    ├── qris.ts         # Parser TLV EMVCo + CRC16-CCITT
    ├── telegram.ts     # Notifikasi Bot Telegram
    ├── token-checker.ts# Validator token berkala (5 menit)
    ├── dedup.ts        # Anti double-claim (TTL 24 jam)
    └── logger.ts       # Circular log in-memory
tests/
├── preload.ts          # Environment khusus test
├── qris.test.ts        # Unit test TLV, CRC16, QRIS dinamis
├── helpers.test.ts     # Unit test formatter, dedup, logger
└── app.test.ts         # Test integrasi endpoint via app.handle() (ShopeePay di-mock)
```

## 🔒 Lisensi

[MIT](LICENSE) — bebas digunakan, dimodifikasi, dan didistribusikan.
