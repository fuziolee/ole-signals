#!/bin/bash
# sql/tests/r61_concurrency.sh — Ronde 61 (D2: uji konkurensi T-08).
#
# JALANKAN HANYA DI SCRATCH (Postgres lokal, DB ole_r61_test) — bukan live.
# Pemakaian: bash sql/tests/r61_concurrency.sh
# (dari ~/workspace/ole-signals; skrip memakai sudo -u postgres psql.)
#
# Metode: DUA sesi psql bersamaan, masing-masing memegang transaksi TERBUKA
# (pg_sleep di dalam transaksi menahan kunci baris) sehingga eksekusi
# benar-benar bertabrakan — bukan sekadar berurutan cepat. Tiap sesi
# menulis hasilnya ke file /tmp/r61conc/race-N-{a,b}.out; skrip lalu
# menegaskan hasilnya dan membersihkan fixture.
#
# Yang diuji:
#   RACE-1 (T-08 inti): 2x create_signal bersamaan, trader sudah punya
#     1 sinyal terbuka EURUSD (sisa kuota 1 dari batas 2/pair).
#     Harap: tepat 1 ok + 1 pairlimit; jumlah akhir sinyal terbuka = 2.
#   RACE-2 (idempotensi): 2x create_signal bersamaan dengan kunci
#     idempotensi SAMA (pair lain supaya tidak bentrok RACE-1).
#     Harap: 1 ok + 1 duplicate:true; hanya 1 baris dengan kunci itu.
#   RACE-3 (harga): 2x UPDATE harga bersamaan pada trader L5 (stempel
#     NULL). Harap: tepat 1 berhasil + 1 ditolak cooldown 1x/bulan
#     (transaksi kedua menunggu row lock, lalu trigger mengevaluasi
#     ulang dengan stempel yang baru saja ditulis transaksi pertama).
#   RACE-4 (optimistic locking): 2x update_signal bersamaan dengan
#     p_version SAMA (1) pada satu sinyal PENDING.
#     Harap: 1 ok (versi -> 2) + 1 conflict.
#
# Keluar 0 bila semua lolos, 1 bila ada yang gagal.
set -u
DB=ole_r61_test
OUT=/tmp/r61conc
mkdir -p "$OUT"
chmod 755 "$OUT"
PSQL="sudo -u postgres psql -d $DB -v ON_ERROR_STOP=0 -q -t -A"

# --- SETUP: trader uji konkurensi (UUID e61...) -----------------------------
$PSQL -c "
do \$\$
declare v_ids uuid[] := array['e6100000-0000-0000-0000-000000000001','e6100000-0000-0000-0000-000000000002'];
  v_id uuid;
begin
  delete from public.signals where trader_id = any(v_ids);
  delete from public.trader_progress where trader_id = any(v_ids);
  delete from public.traders where profile_id = any(v_ids);
  delete from public.profiles where id = any(v_ids);
  delete from auth.users where id = any(v_ids);
  foreach v_id in array v_ids loop
    insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at)
    values (v_id, '00000000-0000-0000-0000-000000000000', 'r61c-' || substr(v_id::text, 33, 4) || '@ole-signals.local', 'dummy', now(), '{\"provider\":\"email\",\"providers\":[\"email\"]}', '{}', 'authenticated', 'authenticated', now(), now());
    insert into public.profiles (id, username, display_name)
    values (v_id, 'r61c_' || substr(v_id::text, 33, 4), 'R61C ' || substr(v_id::text, 33, 4))
    on conflict (id) do update set username = excluded.username, display_name = excluded.display_name;
    insert into public.traders (profile_id, username, trader_display_name, is_demo)
    values (v_id, 'r61c_' || substr(v_id::text, 33, 4), 'R61C ' || substr(v_id::text, 33, 4), false)
    on conflict (profile_id) do update set username = excluded.username,
      trader_display_name = excluded.trader_display_name, is_demo = excluded.is_demo;
  end loop;
  -- TC (0001): L1, ref \$10.000. TP (0002): L5, harga NULL (untuk RACE-3).
  insert into public.trader_progress (trader_id, level, balance_usd, level_ref_balance, r_since_level, trades_since_level, peak_balance_usd, max_drawdown_usd, max_drawdown_pct)
  values
    ('e6100000-0000-0000-0000-000000000001', 1, 10000.00, 10000.00, 0, 0, 10000.00, 0, 0),
    ('e6100000-0000-0000-0000-000000000002', 5, 12500.00, 12155.06, 0, 0, 12500.00, 0, 0)
  on conflict (trader_id) do update set level = excluded.level, balance_usd = excluded.balance_usd,
    level_ref_balance = excluded.level_ref_balance, r_since_level = excluded.r_since_level,
    trades_since_level = excluded.trades_since_level, peak_balance_usd = excluded.peak_balance_usd,
    max_drawdown_usd = excluded.max_drawdown_usd, max_drawdown_pct = excluded.max_drawdown_pct;
  -- Harga tetap (jarak entry >= \$2 dari harga, lot acuan 0,01).
  insert into public.prices (pair, price, fetched_at) values ('EURUSD', 1.0951, now()), ('GBPUSD', 1.3090, now())
  on conflict (pair) do update set price = excluded.price, fetched_at = excluded.fetched_at;
  -- 1 sinyal terbuka EURUSD milik TC (kuota tersisa 1).
  insert into public.signals (id, trader_id, pair, direction, entry, stop_loss, take_profit, lot_size, entry_type, status, created_at, expires_at, version)
  values ('e0000000-0000-0000-0000-000000000001', 'e6100000-0000-0000-0000-000000000001', 'EURUSD', 'BUY', 1.0971, 1.0921, 1.1021, 0.02, 'limit', 'PENDING', now(), now() + interval '3 days', 1);
  -- 1 sinyal PENDING untuk RACE-4 (versi 1).
  insert into public.signals (id, trader_id, pair, direction, entry, stop_loss, take_profit, lot_size, entry_type, status, created_at, expires_at, version)
  values ('e0000000-0000-0000-0000-000000000002', 'e6100000-0000-0000-0000-000000000001', 'XAUUSD', 'BUY', 3592.00, 3590.00, 3594.00, 0.02, 'limit', 'PENDING', now(), now() + interval '3 days', 1);
  insert into public.prices (pair, price, fetched_at) values ('XAUUSD', 3590.00, now())
  on conflict (pair) do update set price = excluded.price, fetched_at = excluded.fetched_at;
end \$\$;" > "$OUT/setup.out" 2>&1
echo "SETUP: $(cat $OUT/setup.out | tr -d ' \n')"

TC='e6100000-0000-0000-0000-000000000001'
TP='e6100000-0000-0000-0000-000000000002'
PASS=0; FAIL=0
note() { if [ "$1" = "1" ]; then PASS=$((PASS+1)); echo "PASS $2"; else FAIL=$((FAIL+1)); echo "FAIL $2"; fi; }

# Sesi A: transaksi terbuka + pg_sleep(3) menahan kunci; sesi B mulai 1 detik
# kemudian dan akan BLOKIR di kunci yang sama sampai A commit.
run_race() { # $1=label $2=sql-A $3=sql-B
  local label="$1" sql_a="$2" sql_b="$3"
  ( printf '%s\n' "BEGIN;" "select set_config('request.jwt.claims', '{\"sub\":\"$TC\",\"role\":\"authenticated\",\"aud\":\"authenticated\"}', false);" "$sql_a" "select pg_sleep(3);" "COMMIT;" | sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=0 -q -t -A > "$OUT/$label-a.out" 2>&1 ) &
  local pid_a=$!
  sleep 1
  ( printf '%s\n' "BEGIN;" "select set_config('request.jwt.claims', '{\"sub\":\"$TC\",\"role\":\"authenticated\",\"aud\":\"authenticated\"}', false);" "$sql_b" "COMMIT;" | sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=0 -q -t -A > "$OUT/$label-b.out" 2>&1 ) &
  local pid_b=$!
  wait $pid_a; wait $pid_b
}

# --- RACE-1: 2x create EURUSD (kuota tersisa 1) ------------------------------
run_race race1 \
  "select public.create_signal('EURUSD','BUY',1.0971,1.0921,1.1021,0.02,'r61c-race1-a');" \
  "select public.create_signal('EURUSD','BUY',1.0972,1.0922,1.1022,0.02,'r61c-race1-b');"
ok1=$(grep -c '"ok": true' "$OUT/race1-a.out" "$OUT/race1-b.out" 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
lim1=$(grep -c 'pairlimit' "$OUT/race1-a.out" "$OUT/race1-b.out" 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
cnt1=$($PSQL -c "select count(*) from public.signals where trader_id='$TC' and pair='EURUSD' and status in ('PENDING','AKTIF');")
note "$([ "$ok1" = "1" ] && [ "$lim1" = "1" ] && [ "$cnt1" = "2" ] && echo 1 || echo 0)" "RACE-1 T-08: ok=$ok1 pairlimit=$lim1 open=$cnt1 (harap 1/1/2)"

# --- RACE-2: 2x create GBPUSD, kunci idempotensi SAMA ------------------------
run_race race2 \
  "select public.create_signal('GBPUSD','BUY',1.3110,1.3060,1.3160,0.02,'r61c-race2-same');" \
  "select public.create_signal('GBPUSD','BUY',1.3110,1.3060,1.3160,0.02,'r61c-race2-same');"
dup2=$(grep -c '"duplicate": true' "$OUT/race2-a.out" "$OUT/race2-b.out" 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
cnt2=$($PSQL -c "select count(*) from public.signals where trader_id='$TC' and idempotency_key='r61c-race2-same';")
note "$([ "$dup2" = "1" ] && [ "$cnt2" = "1" ] && echo 1 || echo 0)" "RACE-2 idempotensi: duplicate=$dup2 rows=$cnt2 (harap 1/1)"

# --- RACE-3: 2x UPDATE harga bersamaan (trader L5, stempel NULL) ------------
# (Sesi memakai klaim TP, bukan TC — run_race memakai \$TC, jadi tulis manual.)
( printf '%s\n' "BEGIN;" "select set_config('request.jwt.claims', '{\"sub\":\"$TP\",\"role\":\"authenticated\",\"aud\":\"authenticated\"}', false);" "update public.traders set subscription_price_usd = 18.75 where profile_id = '$TP';" "select pg_sleep(3);" "COMMIT;" | sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=0 -q -t -A > "$OUT/race3-a.out" 2>&1 ) &
pid_a=$!
sleep 1
( printf '%s\n' "BEGIN;" "select set_config('request.jwt.claims', '{\"sub\":\"$TP\",\"role\":\"authenticated\",\"aud\":\"authenticated\"}', false);" "update public.traders set subscription_price_usd = 25.00 where profile_id = '$TP';" "COMMIT;" | sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=0 -q -t -A > "$OUT/race3-b.out" 2>&1 ) &
pid_b=$!
wait $pid_a; wait $pid_b
cool3=$(grep -c '1× sebulan' "$OUT/race3-a.out" "$OUT/race3-b.out" 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
price3=$($PSQL -c "select subscription_price_usd from public.traders where profile_id='$TP';")
stamp3=$($PSQL -c "select case when subscription_price_changed_at is null then 'null' else 'set' end from public.traders where profile_id='$TP';")
note "$([ "$cool3" = "1" ] && [ "$stamp3" = "set" ] && echo 1 || echo 0)" "RACE-3 harga: cooldown_reject=$cool3 final_price=$price3 stamp=$stamp3 (harap 1/<18.75 atau 25>/set)"

# --- RACE-4: 2x update_signal versi SAMA (1) --------------------------------
SIG4='e0000000-0000-0000-0000-000000000002'
run_race race4 \
  "select public.update_signal('$SIG4','XAUUSD','BUY',3592.00,3590.00,3594.00,0.02,1);" \
  "select public.update_signal('$SIG4','XAUUSD','BUY',3592.50,3590.50,3594.50,0.02,1);"
ok4=$(grep -c '"ok": true' "$OUT/race4-a.out" "$OUT/race4-b.out" 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
con4=$(grep -c 'conflict' "$OUT/race4-a.out" "$OUT/race4-b.out" 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
ver4=$($PSQL -c "select version from public.signals where id='$SIG4';")
note "$([ "$ok4" = "1" ] && [ "$con4" = "1" ] && [ "$ver4" = "2" ] && echo 1 || echo 0)" "RACE-4 optimistic lock: ok=$ok4 conflict=$con4 version=$ver4 (harap 1/1/2)"

# --- CLEANUP -----------------------------------------------------------------
$PSQL -c "
delete from public.signals where trader_id in ('$TC','$TP');
delete from public.trader_progress where trader_id in ('$TC','$TP');
delete from public.traders where profile_id in ('$TC','$TP');
delete from public.profiles where id in ('$TC','$TP');
delete from auth.users where id in ('$TC','$TP');" > /dev/null 2>&1

echo "RINGKASAN: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] && exit 0 || exit 1
