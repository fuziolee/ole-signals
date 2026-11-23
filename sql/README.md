# OLE Signals — SQL Supabase (Fase 1–2)

Skema + RLS + fungsi keamanan untuk build nyata. Target project:
**`ole-signals`** (Singapore, Free) — https://hhukbtpcsepjkszveejx.supabase.co

Sumber: `blueprint-build-nyata.md` (§4, §5, §12, §13) dan dokumen
kriteria penerimaan (`Kriteria_Penerimaan_Sinyal__Langganan__dan_Dompet.pdf`).
Keputusan yang dipegang: mulai kosong (tanpa seed), login email+password
saja, saldo simulasi $10.000, pembayaran DITANGGUHKAN (dibangun terakhir).

## File

| File | Isi |
|---|---|
| `01_schema.sql` | Semua tabel (§4) + `audit_log` + `copies` (§12 bug #1) + kolom KYC di `profiles` (§13). Tanpa seed. |
| `02_rls.sql` | RLS aktif di SEMUA tabel + kebijakan + GRANT. |
| `03_functions.sql` | Fungsi RPC `SECURITY DEFINER`: `create_signal`, `update_signal`, `cancel_signal`, `setup_trader_identity`, `get_my_kyc_status` + trigger (`handle_new_user`, `ensure_trader_progress`). |
| `04_verify_tests.sql` | Tes T-01..T-12 + RLS (dijalankan di SQL Editor; T-08 dari dua tab) + T-13..T-17 (Ronde 7: username follower/nama/cooldown). |
| `05_verify_cleanup.sql` | Hapus akun uji A/B + datanya setelah tes verifikasi. |
| `06_diagnosa_R5.sql` | Diagnosa ronde 5 (arsip). |
| `07_smoke_cleanup.sql` | Hapus akun smoke test + datanya. |
| `08_storage_avatars.sql` | Bucket Storage `avatars` + policy (baca publik, tulis hanya folder sendiri). |
| `09_demo_traders_migration.sql` | Kolom `traders.is_demo` (penanda trader demo berlabel). |
| `10_demo_traders_insert.sql` | 3 trader demo (Alpha/Beta/Gamma) + 21 sinyal demo. Cari akun demo BERDASARKAN EMAIL — buat dulu 3 akun auth via dashboard (lihat header file). |
| `11_demo_traders_delete.sql` | Hapus SEMUA data demo (trader, progress, sinyal, follows/subs/copies/notifikasi, profil, auth) tanpa menyentuh data lain. |
| `12_traders_username_split.sql` | Ronde 6b: kolom `traders.username` (username trader terpisah dari username follower) + backfill dari `profiles.username` + NOT NULL + format CHECK + unique index + trigger nama dilindungi. **TERAPKAN DULU, baru terapkan ulang `03_functions.sql`, baru deploy frontend baru** (lihat urutan di bawah). |
| `13_follower_username.sql` | Ronde 7 (D05): kolom cooldown (`profiles.username_changed_at`, `profiles.display_name_changed_at`, `traders.username_changed_at`) + `check_username` / `set_follower_username` / `set_profile_name` (validasi format/banned/reserved/taken + cooldown 1×/bulan server-side, kecuali akun demo) + **redefinisi `setup_trader_identity` dengan cooldown username trader**. Daftar kata terlarang di-port dari prototipe. **TERAPKAN SETELAH 12 (dan setelah 03); bila 03 diterapkan ulang sesudahnya, terapkan ulang 13** — kalau tidak, cooldown trader hilang. |

## Cara pakai (Supabase SQL Editor)

1. Buka project `ole-signals` → **SQL Editor** → **New query**.
2. Tempel isi `01_schema.sql`, jalankan. Lalu `02_rls.sql`, lalu
   `03_functions.sql` — **urutan ini wajib** (fungsi di 03 memakai tabel
   di 01; kebijakan di 02 memakai fungsi penjaga yang didefinisikan di 02).
3. Semua file idempotent (aman dijalankan ulang).
4. **Ronde 6b (migrasi 12):** setelah 03, terapkan
   `12_traders_username_split.sql`, lalu terapkan **ulang**
   `03_functions.sql` (versi baru `setup_trader_identity` menulis
   `traders.username`), **baru** deploy frontend baru. Frontend baru yang
   jalan sebelum migrasi 12 akan gagal (kolom `traders.username` belum ada).
5. **Ronde 7 (migrasi 13):** setelah langkah 4, terapkan
   `13_follower_username.sql` (kolom cooldown + RPC username follower /
   nama profil + `setup_trader_identity` ber-cooldown), **baru** deploy
   frontend Ronde 7. Frontend Ronde 7 yang jalan sebelum migrasi 13 akan
   gagal di form username (`check_username` / `set_follower_username` /
   `set_profile_name` belum ada). Perhatian: bila `03_functions.sql`
   diterapkan ulang kapan pun SETELAH 13, terapkan ulang 13 sesudahnya —
   03 menimpa `setup_trader_identity` versi ber-cooldown dengan versi lama.
5. Aktifkan **Email** provider di **Authentication → Providers**
   (email+password saja; Google OAuth TIDAK diaktifkan).

Panggil dari frontend (Supabase JS):

```js
supabase.rpc('setup_trader_identity', { p_username, p_display_name })
supabase.rpc('create_signal', { p_pair, p_direction, p_entry, p_stop_loss,
  p_take_profit, p_lot, p_idempotency_key })
supabase.rpc('update_signal', { p_signal_id, p_pair, p_direction, p_entry,
  p_stop_loss, p_take_profit, p_lot, p_version })
supabase.rpc('cancel_signal', { p_signal_id })
```

Jawaban selalu JSON: `{ok, code, message, signal?}`. Kode galat:
`pairlimit` / `notpending` / `conflict` / `taken` → HTTP 409;
`rr` / `risk` / `invalid` / `needusername` / `pair` → HTTP 422.
(`cooldown` dipakai Ronde 7 untuk username/nama 1×/bulan; untuk fase
pembayaran dicadangkan terpisah.)

## Cara verifikasi (cek manual — petakan ke tes kriteria penerimaan)

Siapkan dua akun uji (A dan B) + satu baris harga di `prices`
(`insert into prices (pair, price) values ('USDJPY', 150.00)` — via SQL
Editor, service role — supaya hitung risiko pair non-USD jalan;
pair quote-USD seperti XAUUSD/EURUSD tidak butuh konversi).

- **T-01** — A buat 2 sinyal XAUUSD PENDING → keduanya `ok: true`.
  Sinyal ke-3 di pair yang sama → `{ok: false, code: 'pairlimit'}`.
- **T-02** — A buat 1 sinyal EURUSD, lalu `update_signal` ke XAUUSD
  (yang sudah berisi 2) → `pairlimit`; jumlah sinyal terbuka XAUUSD
  tetap 2.
- **T-03** — A ubah sinyal di pair yang sudah berisi 2 sinyal terbuka
  **tanpa ganti pair** (mis. ubah entry saja) → `ok: true`.
- **T-04** — A ubah sinyal ke pair yang berisi 1 sinyal → `ok: true`.
- **T-05** — Buat sinyal AKTIF (atau tunggu settlement) lalu
  `update_signal` / `cancel_signal` → `notpending`.
- **T-06** — A batalkan satu sinyal PENDING → `ok: true`; buat sinyal
  baru di pair itu → berhasil (kuota pulih). Sinyal yang dibatalkan
  tidak terlihat oleh B (`select` sebagai B tidak mengembalikannya),
  tapi barisnya masih ada dengan status `CANCELLED`.
- **T-07** — `update_signal` dengan `p_version` lama (bukan versi saat
  ini) → `{ok: false, code: 'conflict'}`.
- **T-08** — Pair dengan 1 sinyal terbuka; jalankan 2 `create_signal`
  bersamaan (dua tab / `Promise.all`) → tepat satu berhasil, satu
  `pairlimit`; jumlah akhir sinyal terbuka = 2.
- **T-09** — `create_signal` dua kali dengan `p_idempotency_key` yang
  sama → panggilan kedua mengembalikan `{duplicate: true}` dan hanya
  ada SATU baris sinyal.
- **T-10** — `select * from audit_log where signal_id = ...` → ada
  baris `signal_create` / `signal_update` / `signal_cancel` dengan
  `before_data` / `after_data`.
- **RLS** — Sebagai A, coba tulis langsung:
  `supabase.from('signals').insert({...})` → DITOLAK (tidak ada policy).
  `supabase.from('trader_progress').update(...)` → DITOLAK.
  `supabase.from('audit_log').select()` sebagai B → hanya baris B
  sendiri (baris A tidak terlihat).

## Yang SUDAH diverifikasi — dan yang BELUM (jujur)

- **Sudah:** sintaks ketiga file diperiksa dengan parser PostgreSQL
  (`pglast`, libpg_query) — lolos tanpa galat sintaks. Aturan-aturan
  di atas dibaca ulang dan dicocokkan dengan blueprint §4/§5/§12/§13
  serta kriteria penerimaan.
- **BELUM:** perilaku terhadap database Supabase sungguhan. File ini
  **belum pernah dijalankan** di project `ole-signals`. Tes T-01..T-15
  di atas HARUS dijalankan dan lolos sebelum luncur — terutama T-08
  (konkurensi) dan uji RLS. Jangan sebut SQL ini "aman" sebelum tes
  itu dijalankan. (Perintah user 23 Nov 2026: klaim keamanan harus
  dibuktikan tes yang benar-benar dijalankan; yang belum terverifikasi
  dinyatakan belum terverifikasi.)

## Asumsi & catatan

1. **Aturan sentuh entry (AC-EDIT-07):** entry dianggap tersentuh bila
   harga saat ini sudah melewatinya — BUY: harga ≤ entry; SELL: harga
   ≥ entry. Konfirmasi ulang saat `settle-signals` ditulis (Fase 3);
   bila aturan settlement berbeda, samakan fungsi ini.
2. **XAGUSD** tidak masuk daftar pair (ukuran kontraknya belum
   diputuskan). Tambahkan setelah diputuskan produk.
3. **Deteksi duplikasi dua lapis (§5) belum diimplementasikan.**
   Kolom `duplicate_of` / `duplicate_flagged` sudah siap; deteksi
   jalan di langkah lanjutan Fase 2 (butuh tabel pip per pair).
4. **Settlement (AKTIF/WIN/LOSS) dan hitung ulang level/statistik**
   (`recalc_trader_progress`) adalah Fase 3–4 (Edge Functions),
   bukan file ini. Kolom-kolomnya sudah disiapkan.
5. **KYC:** kolom `kyc_*` di `profiles` hanya boleh DIUBAH oleh
   service_role (webhook Zyphe) — dijaga trigger. Namun kolom itu
   masih BISA DIBACA lewat SELECT publik pada `profiles` (kebijakan
   RLS membaca profil bersifat publik). Ini bisa diterima karena
   `kyc_reference` hanyalah ID sesi Zyphe (bukan kredensial) dan
   `kyc_reject_reason` hanya teks alasan. Bila nanti diputuskan kedua
   kolom itu harus rahasia, pindahkan ke tabel terpisah dengan RLS
   owner-only.
6. **Username yang dilindungi** (admin/support/dll., termasuk varian
   leet seperti `4dm1n`) ditolak di database (aturan prototipe ronde 21).
7. **Tabel pembayaran tidak dibuat:** `subscriptions` ada tapi tidak
   dipakai di MVP; tabel dompet/penarikan (`wallet_balances`,
   `withdrawals` — §12 bug #2) dibuat di fase pembayaran (terakhir).
8. **Tidak ada kredensial** di file-file ini. Kunci API (UniRateAPI
   dll.) disimpan di Supabase Secrets, bukan di SQL/kode.
