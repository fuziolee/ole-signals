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
| `14_shared_lock.sql` | Ronde 9 (cacat 4): kolom `signals.shared_at` + RPC `mark_signal_shared` + `update_signal` versi lengkap (menolak edit sinyal yang sudah dibagikan, kode `shared`). **TERAPKAN SEBELUM deploy frontend Ronde 9** — frontend Ronde 9 memanggil `mark_signal_shared` dan membaca `shared_at`; tanpa migrasi ini tombol bagikan tetap jalan (best-effort) tapi kunci server tidak aktif. |
| `15_share_closed_only.sql` | Ronde 19: RPC `mark_signal_shared` versi baru — menolak berbagi sinyal yang belum selesai (status bukan WIN/LOSS) dengan kode `notclosed`; sinyal yang sudah dibagikan sebelum Ronde 19 tetap ok (grandfathered). **TERAPKAN SEBELUM deploy frontend Ronde 19.** Perhatian: bila `03_functions.sql` diterapkan ulang kapan pun SETELAH 15, terapkan ulang 15 sesudahnya — 03 menimpa `mark_signal_shared` versi ber-`notclosed` dengan versi lama. |
| `r8-notif-fix.sql` | Ronde 8: `create_signal` / `update_signal` / `cancel_signal` + grants (perbaikan notifikasi: pesan generik untuk sinyal berbayar + @username). **PERHATIAN URUTAN:** file ini mendefinisikan ulang `update_signal` TANPA cek `shared_at` — bila diterapkan SETELAH `14_shared_lock.sql`, kunci shared hilang diam-diam. Terapkan r8 HANYA sebelum 14, atau terapkan ulang 14 sesudahnya. |
| `16_audit_guards.sql` | Ronde 27 (audit pra-Fase 3, K-1 + T-3): perluas `guard_profile_kyc_columns()` agar menjaga `is_admin` (hanya service_role); trigger baru `guard_profile_cooldown_columns()` (cooldown username/nama 1×/bulan + kunci nama saat KYC terverifikasi + anti-utak-atik stempel) dan `guard_trader_guards()` (cooldown username trader + gerbang Level 5 / rentang Rp100.000–Rp10.000.000 / cooldown harga 1×/bulan + larangan mengangkat diri jadi demo). Hanya menambah/memperluas trigger — TIDAK mendefinisikan ulang RPC apa pun dari 03/13/14/15. **TERAPKAN SETELAH 01–15 + r8, SEBELUM verifikasi negatif live.** |
| `17_profiles_public_view.sql` | Ronde 27 (audit pra-Fase 3, T-1): view `profiles_public` (kolom publik saja: id, username, display_name, avatar_url, region, created_at) + policy baca `profiles` menjadi owner-only (`profiles_select_own`) + revoke SELECT anon pada tabel dasar. Sesudah ini `kyc_*` + `is_admin` tidak lagi terbaca publik. **TERAPKAN SETELAH 16.** Frontend tidak membaca `profiles` publik (semua call site adalah baris milik sendiri — lihat `visual-diff/r27-inventory.md`), jadi tidak ada frontend yang bergantung pada migrasi ini. |
| `18_fase3_settlement.sql` | **Fase 3:** `settle_signals()` (SECURITY DEFINER, hanya service_role) — kedaluwarsa PENDING → EXPIRED, aktivasi PENDING → AKTIF, penutupan AKTIF → WIN/LOSS (profit_usd/profit_pips/r_value/holding_minutes, close_price = level TP/SL) + `recalc_trader_progress()` (level inkremental: tangga tetap ref(L) = $10.000 × 1,05^(L−1); naik butuh AND saldo + R + 5 trade; saldo/peak/max DD dihitung ulang penuh dari sinyal tertutup) + tabel `settlement_runs` (ringkasan tiap putaran) + `quote_to_usd`/`contract_size`/`pip_size` (dipindah dari 03 ke sini agar settlement tidak bergantung pada urutan 03) + grants service_role. Harga basi (> 30 menit) TIDAK PERNAH menutup sinyal. **TERAPKAN SETELAH 01–17. TIDAK ADA perubahan frontend di Fase 3.** |
| `19_fase3_tests.sql` | **Fase 3 (tes saja, bukan migrasi):** F3-01..F3-13 + SETUP + CLEANUP, pola 04 (tabel temp `test_results`, satu tes gagal tidak menghentikan yang lain). Jalankan di SQL Editor SETELAH 18. **PERHATIAN:** `settle_signals()` memproses SEMUA sinyal terbuka — jalankan hanya bila harga live tidak menyentuh sinyal demo/sungguhan, atau saat pasar tutup (lihat header file). |
| `20_fase3_cron.sql` | **Fase 3 (jadwal):** pg_cron `fetch-prices-15min` (*/15) → `net.http_post` ke Edge Function `fetch-prices` dengan anon key. **TERAPKAN SETELAH 18 + deploy kedua Edge Function.** Ganti placeholder `<ANON_KEY>` dengan anon key dari `js/config.js` sebelum menjalankan. |

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
6. **Ronde 9 (migrasi 14):** terapkan `14_shared_lock.sql` (kolom
   `signals.shared_at` + RPC `mark_signal_shared` + `update_signal` dengan
   cek shared), **baru** deploy frontend Ronde 9. Tanpa migrasi ini,
   `mark_signal_shared` belum ada (bagikan tetap jalan, best-effort) dan
   `shared_at` belum bisa dibaca (kunci UI tidak aktif).
7. **Ronde 19 (migrasi 15):** terapkan `15_share_closed_only.sql`
   (`mark_signal_shared` menolak sinyal belum selesai, kode `notclosed`),
   **baru** deploy frontend Ronde 19.
8. **Ronde 27 (migrasi 16 + 17):** terapkan `16_audit_guards.sql`
   (penjaga `is_admin` + cooldown username/nama/harga + gerbang Level 5),
   lalu `17_profiles_public_view.sql` (view `profiles_public` + baca
   `profiles` owner-only). **Baru** jalankan verifikasi negatif live
   (PATCH `is_admin` sebagai akun tes HARUS ditolak; baca `profiles`
   sebagai anon HARUS kosong/gagal; lihat `visual-diff/r27-defect-report.md`
   § "Langkah deploy"). Tidak ada perubahan frontend di Ronde 27.
9. **Fase 3 (migrasi 18 + Edge Functions + cron 20):** terapkan
   `18_fase3_settlement.sql`, lalu deploy kedua Edge Function
   (`supabase/functions/fetch-prices/index.ts`,
   `supabase/functions/settle-signals/index.ts` — lewat Dashboard →
   Edge Functions → editor, JANGAN via CLI), lalu terapkan
   `20_fase3_cron.sql` (ganti `<ANON_KEY>` dulu). **Baru** jalankan
   `19_fase3_tests.sql` di SQL Editor (baca peringatan di header file
   itu dulu — jangan jalankan saat harga live menyentuh sinyal demo).
   Tidak ada perubahan frontend di Fase 3.
7. Aktifkan **Email** provider di **Authentication → Providers**
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
   ≥ entry. **DIKONFIRMASI untuk settlement di Fase 3 (sql/18):** aturan
   yang sama dipakai `settle_signals()`. Konsekuensi yang diuji (F3-01/
   F3-13): satu harga tidak bisa sekaligus menyentuh entry dan TP, jadi
   WIN selalu butuh minimal dua putaran; satu-satunya penutupan dalam
   satu putaran adalah LOSS saat harga melompat menembus entry DAN SL
   sekaligus (gap-down BUY / gap-up SELL).
2. **XAGUSD** tidak masuk daftar pair (ukuran kontraknya belum
   diputuskan). Tambahkan setelah diputuskan produk.
3. **Deteksi duplikasi dua lapis (§5) belum diimplementasikan.**
   Kolom `duplicate_of` / `duplicate_flagged` sudah siap; deteksi
   jalan di langkah lanjutan Fase 2 (butuh tabel pip per pair).
4. **Settlement (AKTIF/WIN/LOSS) dan hitung ulang level/statistik**
   (`recalc_trader_progress`) **DIBANGUN di Fase 3** (`18_fase3_settlement.sql`
   + Edge Functions `fetch-prices` / `settle-signals` + cron 20; laporan
   build: `visual-diff/laporan-fase-3.md`). Statistik server + leaderboard
   komposit tetap Fase 4; deteksi duplikasi + notifikasi kedaluwarsa/
   inaktivitas tetap Fase 5.
5. **KYC:** kolom `kyc_*` di `profiles` hanya boleh DIUBAH oleh
   service_role (webhook Zyphe) — dijaga trigger. Sejak migrasi 17
   (Ronde 27), kolom itu juga TIDAK BISA DIBACA publik: baca `profiles`
   owner-only, direktori publik lewat view `profiles_public` (kolom
   publik saja). Sebelum migrasi 17, kolom KYC masih terbaca lewat
   SELECT publik — itu temuan T-1 audit pra-Fase 3.
6. **Username yang dilindungi** (admin/support/dll., termasuk varian
   leet seperti `4dm1n`) ditolak di database (aturan prototipe ronde 21).
7. **Tabel pembayaran tidak dibuat:** `subscriptions` ada tapi tidak
   dipakai di MVP; tabel dompet/penarikan (`wallet_balances`,
   `withdrawals` — §12 bug #2) dibuat di fase pembayaran (terakhir).
8. **Tidak ada kredensial** di file-file ini. Kunci API (UniRateAPI
   dll.) disimpan di Supabase Secrets, bukan di SQL/kode.
