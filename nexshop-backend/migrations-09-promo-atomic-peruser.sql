-- =====================================================================
-- NexShop — migration: kode promo jadi (1) atomic pas nambah used_count
-- (fix race condition kalau ada beberapa transaksi lunas hampir bareng),
-- dan (2) bisa dibatasi berapa kali boleh dipakai PER USER, gak cuma
-- batas total (max_uses) kayak sebelumnya.
-- Jalankan di Supabase SQL Editor. Aman dijalankan ulang.
-- =====================================================================

-- null = gak ada batas per-user (perilaku lama, cocok buat kode diskon
-- umum). Isi misal 1 buat kode "khusus pembeli baru" biar gak dipakai
-- berkali-kali sama akun/email yang sama.
alter table promo_codes add column if not exists max_uses_per_user integer;

-- Catatan tiap kali kode promo BENERAN kepakai (order-nya udah "paid").
-- email disimpan lowercase biar perbandingan konsisten (gak sensitif
-- besar-kecil huruf).
create table if not exists promo_redemptions (
    id bigint generated always as identity primary key,
    promo_code_id bigint not null references promo_codes(id) on delete cascade,
    email text not null,
    order_id text not null,
    created_at timestamptz not null default now()
);
create index if not exists idx_promo_redemptions_lookup on promo_redemptions(promo_code_id, email);

-- Fungsi atomic: cek dulu masih di bawah max_uses ATAU ENGGAK, sekalian
-- naikkin used_count, SEMUA DALAM SATU TRANSAKSI dengan row lock ("for
-- update") -- jadi kalau 2 request nyampe barengan persis, salah satunya
-- otomatis nunggu giliran (bukan keduanya baca angka lama yang sama trus
-- keduanya lolos kayak sebelumnya).
create or replace function increment_promo_usage(p_promo_id bigint)
returns table(success boolean, new_used_count integer) as $$
declare
    v_max_uses integer;
    v_used_count integer;
begin
    select max_uses, used_count into v_max_uses, v_used_count
    from promo_codes
    where id = p_promo_id
    for update;

    if not found then
        return query select false, null::integer;
        return;
    end if;

    if v_max_uses is not null and v_used_count >= v_max_uses then
        return query select false, v_used_count;
        return;
    end if;

    update promo_codes
    set used_count = used_count + 1, updated_at = now()
    where id = p_promo_id;

    return query select true, v_used_count + 1;
end;
$$ language plpgsql;
