-- Seed script for topup_category_map to group TokoVoucher categories into NexShop categories
INSERT INTO topup_category_map (tokovoucher_category_name, nexshop_category_name)
VALUES 
    ('Topup Game', 'Gaming'),
    ('Voucher Game', 'Voucher Game'),
    ('E-Money', 'E-Wallet'),
    ('Pulsa', 'Pulsa'),
    ('Pulsa Transfer', 'Pulsa'),
    ('Telpon & SMS', 'Pulsa'),
    ('Paket Data', 'Paket Data'),
    ('Voucher Data', 'Paket Data'),
    ('Hiburan', 'Hiburan'),
    ('PLN', 'PLN'),
    ('TV', 'Tagihan'),
    ('Pascabayar', 'Tagihan'),
    ('Aktivasi Perdana', 'Lainnya'),
    ('Injek Voucher Kosong', 'Lainnya'),
    ('Transfer Dana', 'Lainnya')
ON CONFLICT (tokovoucher_category_name) DO UPDATE 
SET nexshop_category_name = EXCLUDED.nexshop_category_name;
