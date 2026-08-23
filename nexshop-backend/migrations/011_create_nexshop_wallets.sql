-- Migration 011: NexShop Wallet Ledger, Topup iPaymu & Atomic Balance
--
-- CATATAN: File migration di repo ini TIDAK dijalankan otomatis (lihat AGENTS.md).
-- Terapkan file ini di Supabase SQL Editor sebelum fitur NexShop Wallet dipakai.
-- Kode backend dibuat graceful: selama tabel baru belum ada, endpoint
-- akan memberikan pesan yang ramah tanpa error 500 mentah.

-- ===========================================================
-- 1. Tabel Utama: Wallets (Dompet Saldo Internal User & Reseller)
-- ===========================================================
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id BIGINT NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
    wallet_type TEXT NOT NULL DEFAULT 'USER_WALLET' CHECK (wallet_type IN ('USER_WALLET', 'RESELLER_WALLET')),
    balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'IDR',
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'LOCKED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_status ON wallets(status);

-- ===========================================================
-- 2. Tabel Ledger: Wallet Transactions (Riwayat Mutasi Saldo Lengkap)
-- ===========================================================
CREATE TABLE IF NOT EXISTS wallet_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN (
        'TOPUP',
        'PURCHASE',
        'REFUND',
        'ADJUSTMENT',
        'ADMIN_ADJUSTMENT',
        'RESELLER_DEPOSIT',
        'RESELLER_PURCHASE',
        'RESELLER_REFUND'
    )),
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
    balance_before NUMERIC(14, 2) NOT NULL CHECK (balance_before >= 0),
    balance_after NUMERIC(14, 2) NOT NULL CHECK (balance_after >= 0),
    reference_id TEXT NOT NULL UNIQUE, -- Idempotency Key (Mencegah transaksi/callback ganda)
    external_transaction_id TEXT,      -- ID transaksi dari iPaymu / TokoVoucher
    description TEXT,
    status TEXT NOT NULL DEFAULT 'SUCCESS' CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED')),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_trx_wallet_id ON wallet_transactions(wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_trx_user_id ON wallet_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_trx_ref_id ON wallet_transactions(reference_id);
CREATE INDEX IF NOT EXISTS idx_wallet_trx_type ON wallet_transactions(type, created_at DESC);

-- ===========================================================
-- 3. Tabel Invoices: Wallet Topups (Invoice Topup Saldo via iPaymu)
-- ===========================================================
CREATE TABLE IF NOT EXISTS wallet_topups (
    id VARCHAR(64) PRIMARY KEY, -- Format: WT + random hex (misal: WT9A8B7C...)
    user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    fee NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    total NUMERIC(14, 2) NOT NULL CHECK (total > 0),
    payment_method TEXT NOT NULL,
    payment_channel TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED')),
    ipaymu_trx_id TEXT,
    ipaymu_session_id TEXT,
    payment_no TEXT,
    qr_content TEXT,
    payment_url TEXT,
    payment_expired TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_topups_user ON wallet_topups(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_topups_status ON wallet_topups(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_topups_trx_id ON wallet_topups(ipaymu_trx_id);

-- ===========================================================
-- 4. Tambahan Kolom Reseller Tracking & Refund pada topup_orders
-- ===========================================================
ALTER TABLE topup_orders ADD COLUMN IF NOT EXISTS reseller_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE topup_orders ADD COLUMN IF NOT EXISTS reseller_ref_id TEXT;
ALTER TABLE topup_orders ADD COLUMN IF NOT EXISTS api_key_id UUID;
ALTER TABLE topup_orders ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_topup_orders_reseller_user ON topup_orders(reseller_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_topup_orders_reseller_ref ON topup_orders(reseller_user_id, reseller_ref_id) WHERE reseller_ref_id IS NOT NULL;

-- ===========================================================
-- 5. PostgreSQL Stored Procedure: Atomic Credit (Tambah Saldo Atomik)
-- ===========================================================
CREATE OR REPLACE FUNCTION credit_wallet_atomic(
    p_user_id BIGINT,
    p_type TEXT,
    p_amount NUMERIC(14, 2),
    p_reference_id TEXT,
    p_external_trx_id TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB AS $$
DECLARE
    v_wallet wallets%ROWTYPE;
    v_balance_before NUMERIC(14, 2);
    v_balance_after NUMERIC(14, 2);
    v_trx_id UUID;
BEGIN
    -- 1. Validasi nominal positif
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Nominal credit harus lebih besar dari 0';
    END IF;

    -- 2. Cek idempotency: Jika reference_id sudah pernah sukses, return sukses tanpa kredit ulang
    SELECT id INTO v_trx_id FROM wallet_transactions WHERE reference_id = p_reference_id;
    IF v_trx_id IS NOT NULL THEN
        SELECT * INTO v_wallet FROM wallets WHERE user_id = p_user_id;
        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'message', 'Transaksi sudah diproses sebelumnya',
            'wallet_id', v_wallet.id,
            'balance', v_wallet.balance,
            'transaction_id', v_trx_id
        );
    END IF;

    -- 3. Lock baris wallet untuk user ini (Atomic Row Lock)
    SELECT * INTO v_wallet FROM wallets WHERE user_id = p_user_id FOR UPDATE;
    
    -- Buat wallet baru otomatis jika belum ada
    IF v_wallet.id IS NULL THEN
        INSERT INTO wallets (user_id, balance, status)
        VALUES (p_user_id, 0.00, 'ACTIVE')
        RETURNING * INTO v_wallet;
    END IF;

    IF v_wallet.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Dompet saldo sedang dibekukan atau nonaktif';
    END IF;

    v_balance_before := v_wallet.balance;
    v_balance_after := v_balance_before + p_amount;

    -- 4. Update Saldo Wallet
    UPDATE wallets
    SET balance = v_balance_after,
        updated_at = NOW()
    WHERE id = v_wallet.id;

    -- 5. Catat Mutasi ke Ledger
    INSERT INTO wallet_transactions (
        wallet_id,
        user_id,
        type,
        amount,
        direction,
        balance_before,
        balance_after,
        reference_id,
        external_transaction_id,
        description,
        status,
        metadata
    ) VALUES (
        v_wallet.id,
        p_user_id,
        p_type,
        p_amount,
        'IN',
        v_balance_before,
        v_balance_after,
        p_reference_id,
        p_external_trx_id,
        COALESCE(p_description, 'Penambahan saldo'),
        'SUCCESS',
        p_metadata
    ) RETURNING id INTO v_trx_id;

    -- Sinkronkan juga kolom users.balance (backward compatibility)
    UPDATE users SET balance = v_balance_after WHERE id = p_user_id;

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'wallet_id', v_wallet.id,
        'balance_before', v_balance_before,
        'balance_after', v_balance_after,
        'amount', p_amount,
        'transaction_id', v_trx_id
    );
END;
$$ LANGUAGE plpgsql;

-- ===========================================================
-- 6. PostgreSQL Stored Procedure: Atomic Debit (Potong Saldo Atomik)
-- ===========================================================
CREATE OR REPLACE FUNCTION debit_wallet_atomic(
    p_user_id BIGINT,
    p_type TEXT,
    p_amount NUMERIC(14, 2),
    p_reference_id TEXT,
    p_external_trx_id TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB AS $$
DECLARE
    v_wallet wallets%ROWTYPE;
    v_balance_before NUMERIC(14, 2);
    v_balance_after NUMERIC(14, 2);
    v_trx_id UUID;
BEGIN
    -- 1. Validasi nominal positif
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Nominal debit harus lebih besar dari 0';
    END IF;

    -- 2. Cek idempotency
    SELECT id INTO v_trx_id FROM wallet_transactions WHERE reference_id = p_reference_id;
    IF v_trx_id IS NOT NULL THEN
        SELECT * INTO v_wallet FROM wallets WHERE user_id = p_user_id;
        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'message', 'Transaksi sudah diproses sebelumnya',
            'wallet_id', v_wallet.id,
            'balance', v_wallet.balance,
            'transaction_id', v_trx_id
        );
    END IF;

    -- 3. Lock baris wallet (Atomic Row Lock)
    SELECT * INTO v_wallet FROM wallets WHERE user_id = p_user_id FOR UPDATE;

    IF v_wallet.id IS NULL THEN
        RAISE EXCEPTION 'Dompet saldo belum diinisialisasi atau tidak ditemukan';
    END IF;

    IF v_wallet.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Dompet saldo sedang dibekukan atau nonaktif';
    END IF;

    v_balance_before := v_wallet.balance;

    -- 4. Validasi saldo mencukupi
    IF v_balance_before < p_amount THEN
        RAISE EXCEPTION 'Saldo tidak mencukupi. Saldo saat ini: Rp %, dibutuhkan: Rp %', v_balance_before, p_amount;
    END IF;

    v_balance_after := v_balance_before - p_amount;

    -- 5. Update Saldo Wallet
    UPDATE wallets
    SET balance = v_balance_after,
        updated_at = NOW()
    WHERE id = v_wallet.id;

    -- 6. Catat Mutasi ke Ledger
    INSERT INTO wallet_transactions (
        wallet_id,
        user_id,
        type,
        amount,
        direction,
        balance_before,
        balance_after,
        reference_id,
        external_transaction_id,
        description,
        status,
        metadata
    ) VALUES (
        v_wallet.id,
        p_user_id,
        p_type,
        p_amount,
        'OUT',
        v_balance_before,
        v_balance_after,
        p_reference_id,
        p_external_trx_id,
        COALESCE(p_description, 'Pengurangan saldo'),
        'SUCCESS',
        p_metadata
    ) RETURNING id INTO v_trx_id;

    -- Sinkronkan juga kolom users.balance
    UPDATE users SET balance = v_balance_after WHERE id = p_user_id;

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'wallet_id', v_wallet.id,
        'balance_before', v_balance_before,
        'balance_after', v_balance_after,
        'amount', p_amount,
        'transaction_id', v_trx_id
    );
END;
$$ LANGUAGE plpgsql;
