# OLE Signals — SQL Supabase (Fase 1–2)

Skema + RLS + fungsi keamanan untuk build nyata. Target project:
**`ole-signals`** (Singapore, Free) — https://hhukbtpcsepjkszveejx.supabase.co

Sumber: `blueprint-build-nyata.md` (§4, §5, §12, §13) dan dokumen
kriteria penerimaan (`Kriteria_Penerimaan_Sinyal__Langganan__dan_Dompet.pdf`).
Keputusan yang dipegang: mulai kosong (tanpa seed), login email+password
saja, saldo simulasi $10.000, pembayaran DITANGGUHKAN (dibangun terakhir).

## File

**Aturan satu sumber kebenaran (Ronde 61, D3):** tiap fungsi punya SATU file
acuan — file itulah yang diubah bila fungsi itu berubah; jangan pernah
menyalin ulang badan fungsi lengkap ke file migrasi baru (pengecualian
historis: `create_signal`/`update_signal` yang terlanjur tersalin di
03/22/23/26/28 — versi acuan saat ini ada di **28**, dan 03/22/23/26
TIDAK BOLEH diterapkan ulang setelah 28). File tes scratch (bukan
migrasi) tinggal di `sql/tests/` — jangan jalankan di live apa adanya.
File bertanda **SUPERSEDED** arsip saja, jangan diterapkan.

File acuan per fungsi (per Ronde 61, diperbarui Ronde 77, 78, dan 79): `create_signal` →
**36** (Ronde 78; 36 menggantikan create_signal dari 28); `update_signal` → **38**
(Ronde 79; 38 menggantikan update_signal dari 34); `cancel_signal` → **03**; `mark_signal_shared` → **15**;
`setup_trader_identity` → **13**; `settle_signals` + `recalc_trader_progress`
→ **18**; `reset_trader_stats` → **23**; `signal_locked_for` +
`signal_owned_by` + `guard_copy_locked` → **30**; view `signals_public` →
**37** (Ronde 77; 37 menggantikan definisi view dari 30); `guard_follow_requires_username` → **32**; `copy_signal` → **35** (Ronde 73).

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
| `r8-notif-fix.sql` | **SUPERSEDED (Ronde 61, D3) — JANGAN TERAPKAN.** Ronde 8: `create_signal` / `update_signal` / `cancel_signal` (perbaikan notifikasi: pesan generik untuk sinyal berbayar + @username). Isinya sudah hidup di file acuan (blok INSERT notifications MD5 ternormalisasi identik: create/update di **28**, cancel di **03**). Menerapkan file ini sekarang akan REGRESI (versi create/update di sini tanpa cek `shared_at`, jeda reset, dan jarak entry min $2). Arsip saja. |
| `16_audit_guards.sql` | Ronde 27 (audit pra-Fase 3, K-1 + T-3): perluas `guard_profile_kyc_columns()` agar menjaga `is_admin` (hanya service_role); trigger baru `guard_profile_cooldown_columns()` (cooldown username/nama 1×/bulan + kunci nama saat KYC terverifikasi + anti-utak-atik stempel) dan `guard_trader_guards()` (cooldown username trader + gerbang Level 5 / rentang Rp100.000–Rp10.000.000 / cooldown harga 1×/bulan + larangan mengangkat diri jadi demo). Hanya menambah/memperluas trigger — TIDAK mendefinisikan ulang RPC apa pun dari 03/13/14/15. **TERAPKAN SETELAH 01–15 + r8, SEBELUM verifikasi negatif live.** |
| `17_profiles_public_view.sql` | Ronde 27 (audit pra-Fase 3, T-1): view `profiles_public` (kolom publik saja: id, username, display_name, avatar_url, region, created_at) + policy baca `profiles` menjadi owner-only (`profiles_select_own`) + revoke SELECT anon pada tabel dasar. Sesudah ini `kyc_*` + `is_admin` tidak lagi terbaca publik. **TERAPKAN SETELAH 16.** Frontend tidak membaca `profiles` publik (semua call site adalah baris milik sendiri — lihat `visual-diff/r27-inventory.md`), jadi tidak ada frontend yang bergantung pada migrasi ini. |
| `18_fase3_settlement.sql` | **Fase 3:** `settle_signals()` (SECURITY DEFINER, hanya service_role) — kedaluwarsa PENDING → EXPIRED, aktivasi PENDING → AKTIF, penutupan AKTIF → WIN/LOSS (profit_usd/profit_pips/r_value/holding_minutes, close_price = level TP/SL) + `recalc_trader_progress()` (level inkremental: tangga tetap ref(L) = $10.000 × 1,05^(L−1); naik butuh AND saldo + R + 5 trade; saldo/peak/max DD dihitung ulang penuh dari sinyal tertutup) + tabel `settlement_runs` (ringkasan tiap putaran) + `quote_to_usd`/`contract_size`/`pip_size` (dipindah dari 03 ke sini agar settlement tidak bergantung pada urutan 03) + grants service_role. Harga basi (> 30 menit) TIDAK PERNAH menutup sinyal. **TERAPKAN SETELAH 01–17. TIDAK ADA perubahan frontend di Fase 3.** |
| `tests/00_scratch_bootstrap.sql` | **Scratch SAJA, BUKAN migrasi — JANGAN TERAPKAN DI LIVE** (Supabase sudah menyediakan skema `auth`). Stub minimal agar rantai migrasi bisa diuji di Postgres lokal: role `anon`/`authenticated`/`service_role`, skema `auth` + tabel `auth.users` + `auth.uid()` (membaca `request.jwt.claims`), dan `GRANT USAGE ON SCHEMA auth` untuk anon/authenticated (temuan Ronde 61: tanpanya `auth.uid()` gagal 'permission denied for schema auth' saat dipanggil dari trigger UPDATE-only — plan-cache menyembunyikan celah ini pada trigger yang dipicu INSERT). Dipakai pertama oleh `tests/r61_concurrency.sh` dan skrip rebuild scratch. |
| `tests/19_fase3_tests.sql` | **Fase 3 (tes saja, bukan migrasi):** F3-01..F3-13 + SETUP + CLEANUP, pola 04 (tabel temp `test_results`, satu tes gagal tidak menghentikan yang lain). Jalankan di SQL Editor SETELAH 18. **PERHATIAN:** `settle_signals()` memproses SEMUA sinyal terbuka — jalankan hanya bila harga live tidak menyentuh sinyal demo/sungguhan, atau saat pasar tutup (lihat header file). |
| `20_fase3_cron.sql` | **Fase 3 (jadwal):** pg_cron `fetch-prices-15min` (*/15) → `net.http_post` ke Edge Function `fetch-prices` dengan anon key. **TERAPKAN SETELAH 18 + deploy kedua Edge Function.** Ganti placeholder `<ANON_KEY>` dengan anon key dari `js/config.js` sebelum menjalankan. |
| `21_fase3_prices_grant.sql` | **Fase 3 (perbaikan izin):** GRANT tulis tabel `prices` ke service_role (sql/02 hanya memberi SELECT ke anon/authenticated — invoke pertama gagal 500 karenanya). **TERAPKAN SEBELUM invoke Edge Function pertama.** |
| `22_entry_type.sql` | **Ronde 35:** kolom `signals.entry_type` (`limit`/`stop`, default `'limit'`, CHECK) + fungsi `public.infer_entry_type(direction, entry, price)` (BUY entry > harga → stop, ≤ → limit; SELL entry < harga → stop, ≥ → limit; sama persis → limit; tanpa harga → limit) + `signal_to_jsonb` / `create_signal` / `update_signal` versi penyebut-risiko-acuan-level (lihat 03) + `settle_signals` versi cabang-aktivasi-per-jenis (lihat 18). **TERAPKAN SEBELUM 23. Di database baru, terapkan 22 SEBELUM 03/18 versi saat ini** (lihat peringatan urutan di bawah). |
| `23_reset_stats.sql` | **Ronde 35:** kolom `trader_progress.last_reset_at` + `reset_cooldown_until` + `subscriptions.status` ditambah `'paused'` + `copies.signal_snapshot jsonb` + FK `copies.signal_id` diubah ke `ON DELETE SET NULL` (dan `signal_id` jadi nullable) + RPC `public.reset_trader_stats()` (SECURITY DEFINER: cek jeda → kode `resetcooldown`/`resettoosoon`; akun demo bebas jeda; snapshot salinan SEBELUM hapus sinyal; hapus SEMUA sinyal trader; jeda langganan aktif; reset progress ke L1/$10.000/R0/DD0; stempel `last_reset_at` + `reset_cooldown_until` = +1 bulan (NULL untuk demo); notifikasi trader + pelanggan dijeda + penyalin, tipe `'reset'`; audit `'trader_reset'`; kembalikan `{ok, deleted, paused, cooldown_until, refund_pending: true}` — pengembalian prorata DITUNDA bersama fase pembayaran, tidak ada yang ditulis ke dompet mana pun) + helper `public.trader_in_reset_cooldown(trader_id)` + trigger `guard_trader_reset_cooldown` pada `traders` (tolak ubah harga langganan selama jeda, 42501, demo bebas, bypass sistem) + `create_signal` / `update_signal` versi TERBARU (dengan penegakan jeda, kode `resetcooldown`) — **23 menggantikan versi create/update dari 22.** **TERAPKAN SETELAH 22.** |
| `tests/24_r35_tests.sql` | **Ronde 35 (tes saja, bukan migrasi):** R35-RISK-01..06 (batas 1% ref level), R35-ENTRY-00..07 (inferensi + create/update), R35-SET-01..08 (matriks aktivasi per jenis + penutupan satu putaran via gap + grandfather `'limit'`), R35-RESET-01..08 (jalur sukses / penolakan jeda / pengecualian demo / backstop `resettoosoon`), pola 04/19 (tabel temp `test_results`, satu tes gagal tidak menghentikan yang lain). Jalankan di scratch SETELAH 22 + 23 (dan setelah 03/18 versi saat ini). Hasil Ronde 35: **37/37 PASS** di Postgres 16.15 scratch. **JANGAN jalankan di live apa adanya** — SETUP memakai harga tetap + UUID uji; `settle_signals()` di dalamnya memproses sinyal terbuka. |
| `25_drop_balance_check.sql` | **Ronde 35 susulan (diputuskan user 26 Nov 2026 17:18 WIB):** cabut CHECK `balance_usd >= 0` di `trader_progress` (blok DO: cari constraint lewat nama standar `trader_progress_balance_usd_check` ATAU definisi `balance_usd >= (0)` — definisi di `pg_get_constraintdef` tertulis `CHECK ((balance_usd >= (0)::numeric))`, jadi pola tanpa kurung TIDAK cocok; pelajaran dari tes scratch). CHECK lain (`level >= 1`, `trades >= 0`, `max_drawdown >= 0`) TIDAK disentuh. Idempotent. Diuji scratch: saldo −$500 tersimpan sesudah migrasi; `level = 0` tetap ditolak. |
| `26_pending_entry_distance.sql` | **Ronde 59 (diputuskan user 27 Nov 2026 18:56 WIB):** jarak entry PENDING maks **$2,00** dari harga live saat posting/edit, lot acuan tetap **0,01** (bukan lot trader) — helper `public.pending_entry_distance_usd(pair, entry, price)` (STABLE; `|entry − harga| × 0,01 × contract_size × quote_to_usd`; NULL bila harga/konversi tidak ada) + `create_signal` / `update_signal` versi TERBARU dengan langkah 7c (setelah RR langkah 6 + risiko 1% langkah 7): jarak > $2,00 → kode `'distance'` (422); jarak ≤ $2,00 lolos; harga pair tidak ada → fail-closed `'invalid'`. Dibangun dari badan **23** (BUKAN 03 — 03 tidak punya blok jeda reset 2b; menerapkan 03/22/23 setelah 26 akan MENGHAPUS cek jarak + penegakan jeda reset). **26 menggantikan versi create/update dari 23.** Sinyal PENDING lama TIDAK disentuh (tanpa UPDATE retroaktif). |
| `tests/27_r59_tests.sql` | **Ronde 59 (tes saja, bukan migrasi):** H-01..H-05 (helper per kelompok pair + NULL), C-01..C-27 (create: batas tiap kelompok pair, sinyal user 26 Nov ditolak, harga hilang → `'invalid'`, harga basi tetap dipakai, urutan RR-dulu/risiko-dulu, jeda reset masih hidup, PENDING lama utuh), E-01..E-05 (edit: jauh ditolak + sinyal utuh, dekat lolos, edit ke entry == harga → AKTIF, tanpa harga → `'invalid'`, PENDING lama diedit jauh → ditolak). Pola 04/19/24 (tabel temp `test_results`). Jalankan di scratch SETELAH 01, 02, 09, 12, 13, 14, 15, 16, 17, 21, 22, 03, 18, 23, 25, 26. Hasil Ronde 59: **39/39 PASS** di Postgres 16 scratch. **JANGAN jalankan di live** — SETUP memakai harga tetap + UUID uji. |
| `28_r60_min_distance.sql` | **Ronde 60 (diperintahkan user 27 Nov 2026 20:45 WIB, "gasken"): PEMBALIKAN Ronde 59.** Jarak entry PENDING kini MINIMUM **$2,00** dari harga live saat posting/edit, lot acuan tetap **0,01** (bukan lot trader). Helper `public.pending_entry_distance_usd` TIDAK berubah (MD5 ternormalisasi sama seperti di 26: `b832db6769cebd5ff0ea2f139650b588`). `create_signal` / `update_signal` versi TERBARU dengan langkah 7c DIBALIK: jarak < $2,00 → kode `'distance'` (422); jarak >= $2,00 lolos; tidak ada batas maks lagi; harga pair tidak ada → fail-closed `'invalid'`. Dibangun dari badan **26** (BUKAN 03 - 03 tidak punya blok jeda reset 2b; menerapkan 03/22/23/26 setelah 28 akan MENGHAPUS pembalikan + penegakan jeda reset). **28 menggantikan versi create/update dari 26.** Konsekuensi: edit ke entry == harga kini DITOLAK (jarak $0), jadi edit tidak pernah lagi mengaktifkan langsung; blok sentuhan AC-EDIT-07 tetap ada di kode tapi tidak terjangkau lewat edit; settlement (sql/18) tetap mengaktifkan PENDING normal. Sinyal PENDING lama TIDAK disentuh (tanpa UPDATE retroaktif). Alasan user: supaya follower ada waktu menganalisa entry trader dan menyalin sinyalnya. |
| `tests/29_r60_tests.sql` | **Ronde 60 (tes saja, bukan migrasi):** H-01..H-07 (helper per kelompok pair + NULL + contoh user harga emas 4002: entry 4000 = $2,00, 4001 = $1,00), C-01..C-28 (create: tepat $2,00 lolos, di bawah $2,00 ditolak `'distance'`, sinyal user 26 Nov $17/$36 kini LOLOS, entry == harga ditolak, harga hilang → `'invalid'`, harga basi tetap dipakai, urutan RR-dulu/risiko-dulu, jeda reset masih hidup, PENDING lama utuh), E-01a..E-05 (edit: dekat ditolak + sinyal utuh, jauh lolos, edit ke entry == harga DITOLAK + tetap PENDING, tanpa harga → `'invalid'`, PENDING lama diedit dekat → ditolak). Pola 04/19/24 (tabel temp `test_results`). Jalankan di scratch SETELAH 01, 02, 09, 12, 13, 14, 15, 16, 17, 21, 22, 03, 18, 23, 25, 26, 28. Hasil Ronde 60: **42/42 PASS** di Postgres 16 scratch. **JANGAN jalankan di live** - SETUP memakai harga tetap + UUID uji. |
| `30_r61_paywall.sql` | **Ronde 61 (D1 — T-2): paywall sinyal L5+ ditutup DI SERVER.** View `signals_public` (`security_invoker = false`, satu-satunya jalur baca sinyal klien) me-NULL-kan entry/SL/TP/lot/entry_type bila sinyal terkunci bagi pembaca; CANCELLED disembunyikan kecuali milik sendiri (sama seperti policy lama). Helper `signal_locked_for(trader_id, status)` (SECURITY DEFINER, tanpa parameter pembaca — baca `auth.uid()` sendiri, bukan oracle) adalah SATU definisi predikat terkunci (cermin `isLockedForMe` di app.js); `signal_owned_by` (SECURITY DEFINER) untuk policy copies; trigger `guard_copy_locked` menolak INSERT copies atas sinyal terkunci (42501). `revoke select on signals from anon, authenticated` + `grant select on signals_public`. **TIDAK berisi salinan `create_signal`/`update_signal`** — perbaikan T-2 hanya view/policy/grant. **TERAPKAN SETELAH 28, SEBELUM deploy frontend Ronde 61** (frontend Ronde 61 membaca `signals_public`, bukan `signals`). |
| `tests/31_r61_tests.sql` | **Ronde 61 (tes saja, bukan migrasi):** matriks redaksi view (anon/orang asing/pelanggan/pemilik × terkunci/tidak terkunci/WIN/CANCELLED), helper bukan oracle, trigger salinan terkunci, policy copies (pemilik trader bisa baca salinan sinyalnya), regresi gerbang harga L5 (termasuk uji anti-reset harga→NULL→harga dengan trader L5 buatan), cek grant/revoke, uji konkurensi T-08 (skrip terpisah `tests/r61_concurrency.sh`). Pola 04/19/24 (tabel temp `test_results`). Jalankan di scratch SETELAH rantai + 30. **JANGAN jalankan di live** — SETUP memakai UUID uji + harga tetap. |
| `31_fetch_gold_1min.sql` | **Ronde 65 (jadwal):** pg_cron `fetch-gold-1min` (`* * * * *`) → `net.http_post` ke Edge Function `fetch-gold` dengan anon key. HANYA emas (XAUS); forex tetap job `fetch-prices-15min` (sql/20, TIDAK disentuh). **TERAPKAN SETELAH deploy Edge Function fetch-gold.** Ganti placeholder `<ANON_KEY>` dengan anon key dari `js/config.js` sebelum menjalankan. Catatan: tiap putaran settle menulis 1 baris ke `settlement_runs` (tanpa retensi, sql/18). Jalur ini menambah ~43.200 baris/bulan. |
| `32_r69_follow_requires_username.sql` | **Ronde 69:** trigger `guard_follow_requires_username` — BEFORE INSERT pada `follows`, menolak (42501) bila follower tidak punya username di `profiles` (SECURITY DEFINER, pola `guard_copy_locked` sql/30). Grandfathered: baris follows yang sudah ada tidak disentuh; unfollow (DELETE) tidak digerbankan; subscribe tidak digerbankan ronde ini. **TERAPKAN SETELAH 30, SEBELUM deploy frontend Ronde 69.** |
| `33_r70_trader_display_name_username.sql` | **Ronde 70 (keputusan user 2026-11-28 13:48 WIB):** `update public.traders set trader_display_name = username`, nama tampilan trader = username trader, BUKAN nama profil (membalikkan keputusan koordinator R68 yang mengirim nama profil saat submit). Idempotent, tanpa WHERE (berlaku semua trader); menyamakan 4 baris lama (akun tes @trader_tes + 3 demo). Frontend Ronde 70 mengirim username sebagai display_name di jalur buat + ubah username trader. **TERAPKAN SEBELUM deploy frontend Ronde 70.** |
| `34_r72_update_signal_needusername.sql` | **Ronde 72 (temuan S12-MAP-E-19, diperintahkan user 2026-11-28 15:00 WIB):** `update_signal` SAJA: body disalin dari **28** + cek identitas trader SEBELUM `lock_trader_progress`, cermin `create_signal` langkah 1; bila baris `traders` tidak ada, kembalikan kode `'needusername'` (sebelumnya: `lock_trader_progress` INSERT ke `trader_progress` gagal FK → eksepsi Postgres mentah tanpa kode, klien terima galat 500). `create_signal` TIDAK disentuh (tetap versi 28). **34 menggantikan update_signal dari 28.** **TERAPKAN SEBELUM deploy frontend Ronde 72 (tidak ada perubahan frontend ronde ini).** |
| `35_fase5_copy_signal.sql` | **Ronde 73 (Fase 5, iris 1): RPC salin server-side.** `copy_signal(p_signal_id, p_lot default null)` (SECURITY DEFINER), SATU-SATUNYA jalur salin untuk klien; urutan cek cermin `create_signal`: login → sinyal ada → PENDING (kode `notpending`) → tidak terkunci via helper `signal_locked_for` sql/30 (fail-closed; kode BARU `locked`, pesan disamakan dengan trigger `guard_copy_locked`) → duplikat sukses idempoten `{ok, code: 'ok', duplicate: true, copy: {...}}` → lot (NULL = lot sumber; NaN/≤0 → `invalid`) → tulis `insert ... on conflict (follower_id, signal_id) do nothing` lalu baca barisnya. Salin sinyal sendiri DIIZINKAN. `revoke insert on public.copies from authenticated` (cermin R61 yang mencabut SELECT `signals`), tanpa ini RPC bukan penegakan sungguhan; select + delete (uncopy) tetap; trigger `guard_copy_locked` tetap sebagai backstop. **JANGAN ubah `create_signal`/`update_signal`; JANGAN terapkan ulang 03/22/23/26.** **TERAPKAN SETELAH 34, SEBELUM deploy frontend Ronde 73** (frontend Ronde 73 memanggil `copy_signal`, bukan insert langsung). |
| `tests/35_fase5_copy_tests.sql` | **Ronde 73 (tes saja, bukan migrasi):** R73-C-01..C-25 (anon ditolak; tanpa login → `invalid`; sinyal tidak ada → `invalid`; AKTIF/WIN/LOSS/EXPIRED/CANCELLED → `notpending`; terkunci → `locked`; subscriber + pemilik lolos; duplikat idempoten; matriks lot; salin sendiri lolos; insert langsung → ditolak; grant EXECUTE; bentuk JSON copy) + R73-S-01..S-02 (uji perilaku §12 #7: langganan ke diri sendiri ditolak CHECK sebagai pemilik tabel, ditolak grant INSERT sebagai authenticated karena `subscriptions` tanpa grant tulis sama sekali, bukan RLS). Pola 31 (tabel temp `test_results`). Jalankan di scratch SETELAH rantai + 35. **JANGAN jalankan di live**, SETUP memakai UUID uji. |
| `36_r78_notif_generic.sql` | **Ronde 78 (keputusan user A+B, 28 Nov 2026):** `create_signal` SAJA: notifikasi `new_signal` kini SELALU generik, tanpa pair/arah/entry. Trader berbayar (L5+ dengan harga > 0) memakai pesan terkunci untuk semua follower; trader gratis memakai '@username memposting sinyal baru.' Cek langganan per-follower (subquery subscriptions) DIHAPUS: pesan tidak lagi bergantung pada status langganan pembaca. Notifikasi lama TIDAK diubah (opsi A). `update_signal` dan notifikasi 'signal_edited' TIDAK disentuh. **36 menggantikan create_signal dari 28.** **TERAPKAN SETELAH 35.** Tanpa perubahan frontend (migrasi SQL murni, tidak butuh bump ?v dan tidak butuh upload index.html). |
| `tests/36_notif_generic.sql` | **Ronde 78 (tes saja, bukan migrasi):** R78-N-01..N-08 + SETUP (gratis L1, berbayar L5 + pelanggan aktif, non-pelanggan, L5 tanpa harga, regresi jarak, metadata/tepat-satu). Pola 35 (tabel temp `test_results`). Jalankan di scratch SETELAH rantai + 36. **JANGAN jalankan di live**, SETUP memakai UUID uji. Kontrol: tanpa 36, N-01/N-02/N-04/N-05/N-08 FAIL (pesan lama berisi detail). Hasil Ronde 78: **9/9 PASS** di Postgres 16.15 scratch; kontrol 4/9 (5 gagal sesuai prediksi). |
| `37_r77_hide_expired.sql` | **Ronde 77 (keputusan user 19:14 WIB, 28 Nov 2026):** view `signals_public` SAJA, definisi disalin lengkap dari sql/30:106-135, HANYA WHERE berubah menjadi `s.status not in ('CANCELLED', 'EXPIRED') or s.trader_id = auth.uid()` (EXPIRED ikut disembunyikan kecuali milik sendiri, cermin CANCELLED). Tanpa ini EXPIRED tetap bisa dibaca lewat kueri view langsung (temuan R76). Tidak berisi salinan `create_signal`/`update_signal`/`copy_signal`; tidak mengubah grant (CREATE OR REPLACE VIEW mempertahankan grant); tidak menghapus baris data. **37 menggantikan definisi view dari 30. JANGAN terapkan ulang sql/30 sesudah 37** (30 akan mengembalikan hide ini). **TERAPKAN SETELAH 36, SEBELUM deploy frontend Ronde 77** (frontend Ronde 77 menambah filter `.neq('status', 'EXPIRED')` di tiga daftar API). |
| `38_r79_signal_edited_generic.sql` | **Ronde 79 (keputusan user B + hapus sufiks, 28 Nov 2026):** `update_signal` SAJA: notifikasi `signal_edited` (langkah AC-EDIT-08) kini SELALU generik, tanpa pair/arah. Trader berbayar (level >= 5 DAN `subscription_price_usd` > 0, memakai `v_progress.level` yang sudah dikunci/dimuat) memakai pesan terkunci `'@username mengubah sinyal yang Anda salin (berlangganan untuk melihat detailnya).'` untuk semua penyalin; trader gratis memakai `'@username mengubah sinyal yang Anda salin.'` Cek langganan per-penyalin TIDAK ada (cermin R78): pelanggan dan ex-pelanggan menerima teks yang sama. Sufiks `'Sinyal kini AKTIF dan terkunci.'` DIHAPUS total (cabang mati sejak R60: edit tidak pernah mengaktifkan langsung karena jarak min $2 menolak entry == harga; buktinya di plan R79 pasal 1c). Judul tetap `'Sinyal yang Anda salin diubah'`. Notifikasi lama TIDAK diubah (cermin opsi A R78). `create_signal` (tetap 36), `copy_signal` (tetap 35), view (tetap 37) TIDAK disentuh. **38 menggantikan update_signal dari 34. JANGAN terapkan ulang sql/34 sesudah 38** (34 akan mengembalikan pesan berisi pair/arah + sufiks). **TERAPKAN SETELAH 37.** Tanpa perubahan frontend (migrasi SQL murni, tidak butuh bump ?v dan tidak butuh upload index.html). |
| `tests/37_r77_hide_expired.sql` | **Ronde 77 (tes saja, bukan migrasi):** R77-S-01..S-05 + SETUP (matriks view anon/asing/pelanggan/pemilik x PENDING/WIN/EXPIRED/CANCELLED; grant utuh; MD5 `signal_locked_for`; MD5 definisi view; regresi redaksi + `copy_signal` atas EXPIRED tetap `notpending`). Pola 35 (tabel temp `test_results`). Jalankan di scratch SETELAH rantai + 37. **JANGAN jalankan di live**, SETUP memakai UUID uji. Kontrol: tanpa 37, S-01/S-04 FAIL (EXPIRED terlihat non-pemilik). |
| `tests/38_r79_signal_edited_generic.sql` | **Ronde 79 (tes saja, bukan migrasi):** R79-E-01..E-08 + SETUP (pola 36, tabel temp `test_results`, UUID uji e79). E-01 gratis, E-02 berbayar + pelanggan, E-03 sesudah batal langganan (teks terkunci sama), E-04 L5 tanpa harga (teks gratis), E-05 negatif (0 notifikasi `signal_edited` berisi pair/arah/AKTIF, mencakup semua edit), E-06 metadata + tepat-satu (judul tetap, follower non-penyalin 0 baris, edit ke-2 menulis baris ke-2), E-07 regresi penolakan tanpa notifikasi (distance / notpending / conflict / shared), E-08 ganti pair EURUSD ke GBPUSD (AC-EDIT-05: created/expires tidak berubah). Jalankan di scratch SETELAH rantai + 38. **JANGAN jalankan di live**, SETUP memakai UUID uji. Kontrol: tanpa 38, E-01/E-02/E-03/E-04/E-05/E-06/E-08 FAIL (pesan lama berisi pair + arah; E-05 menghitung 8 bocor), hanya SETUP + E-07 PASS. Koreksi atas plan R79 pasal 4a: plan memprediksi E-05/E-06 PASS di kontrol, itu salah (E-05 memeriksa pair/arah juga, bukan hanya sufiks; E-06 di file ini menegaskan teks generik edit ke-2). |

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
10. **Ronde 35 (migrasi 22 + 23):** terapkan `22_entry_type.sql`,
    lalu `23_reset_stats.sql`, **baru** deploy frontend Ronde 35.
    **PERINGATAN URUTAN (cacat D-R35-5):** `03_functions.sql` dan
    `18_fase3_settlement.sql` versi SAAT INI sudah mengandung
    `entry_type` (disinkronkan dengan 22) — file `03` versi saat ini
    GAGAL di database baru yang belum punya kolom `signals.entry_type`
    (`signal_to_jsonb` bahasa SQL divalidasi penuh saat CREATE, baris
    66). Di database LIVE hal ini tidak berpengaruh (03 diterapkan
    jauh sebelum 22; yang diterapkan live hanya 22 → 23). Di database
    BARU: terapkan 22 dulu, baru 03/18 versi saat ini — atau terapkan
    03/18 dari riwayat git dulu, lalu 22, lalu 03/18 saat ini.
    Verifikasi Ronde 35: rantai penuh (01, 02, 03-dari-HEAD, 09, 12,
    13, 14, 15, 16, 17, 18-dari-HEAD, 21, 22, 03-saat-ini,
    18-saat-ini, 23) + `24_r35_tests.sql` **37/37 PASS** di Postgres
    16.15 scratch; `04_verify_tests.sql` 27/28 (satu-satunya gagal
    adalah R7-USERNAME — bentrok LAMA antara tes 04 dan guard R27:
    tes itu membalik `is_demo` langsung, yang memang ditolak guard
    sejak migrasi 16; bukan regresi R35).
11. **Ronde 35 susulan — cabut CHECK saldo negatif (migrasi 25,
    diputuskan user 26 Nov 2026 17:18 WIB "Kerjakan 1,3,4"):**
    terapkan `25_drop_balance_check.sql` (mencabut CHECK
    `balance_usd >= 0` di `trader_progress`; CHECK lain di tabel yang
    sama TIDAK disentuh). Idempotent (no-op bila sudah dicabut).
    Diuji di scratch Postgres 16: sebelum migrasi saldo −$500 ditolak
    CHECK; sesudahnya tersimpan; `level = 0` tetap ditolak CHECK
    `level >= 1`. Setelah dicabut, saldo negatif bisa tersimpan dan
    settlement tidak lagi gagal di CHECK; reset statistik tetap jadi
    jalan keluar saldo terlalu minus.
11. **Aturan risiko (Ronde 35, keputusan user 26 Nov 2026):** risiko
    maks 1% dari SALDO ACUAN LEVEL ref(L) = $10.000 × 1,05^(L−1),
    BUKAN saldo simulasi aktual. ref tidak pernah turun; yang
    naik/turun hanya saldo simulasi. Risiko di bawah maks bebas dipilih
    trader per trade. **TIDAK ADA pengaman baru:** pengaman risiko ≤
    sisa saldo dan pengaman 2% saldo aktual DITOLAK user (26 Nov
    13:54 WIB) — jangan implementasikan. Saldo simulasi adalah angka
    jurnal: boleh minus, ditampilkan apa adanya. CHECK
    `balance_usd >= 0` (01_schema.sql:149) masih ada — pencabutannya
    menunggu konfirmasi user; sementara itu, bila saldo jatuh di bawah
    $0, `recalc_trader_progress` gagal di CHECK dan sinyal terkait
    tetap AKTIF sampai trader reset statistik (jalan keluar yang
    disepakati).
12. Aktifkan **Email** provider di **Authentication → Providers**
   (email+password saja; Google OAuth TIDAK diaktifkan).

Panggil dari frontend (Supabase JS):

```js
supabase.rpc('setup_trader_identity', { p_username, p_display_name })
supabase.rpc('create_signal', { p_pair, p_direction, p_entry, p_stop_loss,
  p_take_profit, p_lot, p_idempotency_key })
supabase.rpc('update_signal', { p_signal_id, p_pair, p_direction, p_entry,
  p_stop_loss, p_take_profit, p_lot, p_version })
supabase.rpc('cancel_signal', { p_signal_id })
supabase.rpc('copy_signal', { p_signal_id, p_lot })
```

Jawaban selalu JSON: `{ok, code, message, signal?}`. Kode galat:
`locked` → HTTP 403 (Ronde 73: sinyal terkunci Level 5+ berbayar);
`pairlimit` / `notpending` / `conflict` / `taken` / `resetcooldown` /
`resettoosoon` → HTTP 409;
`rr` / `risk` / `invalid` / `needusername` / `pair` / `shared` /
`distance` / `notclosed` → HTTP 422.
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
