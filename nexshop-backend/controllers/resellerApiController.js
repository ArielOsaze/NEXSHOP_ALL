const crypto = require("crypto");
const supabase = require("../config/db");
const walletService = require("../services/walletService");
const tokovoucher = require("../config/tokovoucher");
const { getResellerContext } = require("../services/resellerService");
const { hitungHargaReseller, hitungMarkupWajar } = require("../utils/resellerPricing");
const { sendTelegramNotification } = require("../config/notify");

function rupiahLog(n) {
    return "Rp " + Number(n || 0).toLocaleString("id-ID");
}
const { checkNickname } = require("../utils/topupHelpers");

const TOKOVOUCHER_STATUS_MAP = Object.freeze({
    0: "gagal",
    1: "sukses",
    2: "processing"
});

/**
 * POST /api/v1/reseller/orders
 * Pembuatan order produk oleh website reseller via Open API
 */
exports.createOrder = async (req, res) => {
    const { kode_produk, tujuan, server_id, ref_id } = req.body;
    const userId = req.user.id;

    if (!kode_produk || !tujuan) {
        return res.status(400).json({
            success: false,
            message: "Field 'kode_produk' dan 'tujuan' wajib diisi"
        });
    }

    const resellerRefId = ref_id ? String(ref_id).trim() : `REF-${Date.now()}`;

    try {
        // 1. Idempotency Check: Pastikan ref_id reseller belum pernah digunakan
        const { data: existingOrder } = await supabase
            .from("topup_orders")
            .select("id, status, kode_produk, nama_produk, tujuan, server_id, harga, tv_sn, created_at")
            .eq("reseller_user_id", userId)
            .eq("reseller_ref_id", resellerRefId)
            .maybeSingle();

        if (existingOrder) {
            const currentBalance = await walletService.getWalletBalance(userId);
            return res.status(200).json({
                success: true,
                idempotent: true,
                message: "Pesanan dengan ref_id ini sudah pernah dibuat sebelumnya",
                data: {
                    order_id: existingOrder.id,
                    ref_id: resellerRefId,
                    status: existingOrder.status === "sukses" ? "SUCCESS" : (existingOrder.status === "gagal" ? "FAILED" : "PROCESSING"),
                    kode_produk: existingOrder.kode_produk,
                    nama_produk: existingOrder.nama_produk,
                    target: existingOrder.tujuan,
                    server_id: existingOrder.server_id,
                    price: Number(existingOrder.harga),
                    serial_number: existingOrder.tv_sn || null,
                    balance_remaining: currentBalance,
                    created_at: existingOrder.created_at
                }
            });
        }

        // 2. Ambil master produk & hitung harga reseller di backend
        const { data: product, error: prodErr } = await supabase
            .from("topup_products")
            .select("nama, kode_produk, harga_beli, harga_jual, butuh_server_id, kategori, source_operator_name")
            .eq("kode_produk", kode_produk)
            .eq("is_active", true)
            .maybeSingle();

        if (prodErr || !product) {
            return res.status(404).json({
                success: false,
                message: `Produk dengan kode '${kode_produk}' tidak ditemukan atau sedang tidak aktif`
            });
        }

        if (!product.harga_jual || Number(product.harga_jual) <= 0) {
            product.harga_jual = hitungMarkupWajar(product.harga_beli || 0, product.kategori, product.source_operator_name);
        }

        const konteksReseller = await getResellerContext(userId);
        let finalResellerPrice = product.harga_jual;
        if (konteksReseller.isReseller) {
            const hasil = hitungHargaReseller(product.harga_jual, product.harga_beli, konteksReseller.discountPercent);
            finalResellerPrice = hasil.harga;
        }

        if (product.butuh_server_id && !server_id) {
            return res.status(400).json({
                success: false,
                message: "Produk ini memerlukan 'server_id' (Zone ID / Server ID)"
            });
        }

        // 3. Potong saldo reseller secara atomik
        const debitRef = `RSL-PUR-${resellerRefId}-${Date.now()}`;
        let debitResult;
        try {
            debitResult = await walletService.debitWallet({
                userId,
                type: "RESELLER_PURCHASE",
                amount: finalResellerPrice,
                referenceId: debitRef,
                externalTransactionId: resellerRefId,
                description: `Reseller API: Pembelian ${product.nama} (${tujuan})`,
                metadata: {
                    reseller_ref_id: resellerRefId,
                    kode_produk: product.kode_produk,
                    target: tujuan,
                    server_id: server_id || null
                }
            });
        } catch (walletErr) {
            return res.status(400).json({
                success: false,
                message: walletErr.message || "Saldo reseller tidak mencukupi untuk melakukan transaksi ini"
            });
        }

        // 4. Generate Order ID NexShop & simpan ke database
        const orderId = "NX" + crypto.randomBytes(10).toString("hex").toUpperCase();

        const { error: insertErr } = await supabase.from("topup_orders").insert([{
            id: orderId,
            user_id: userId,
            reseller_user_id: userId,
            reseller_ref_id: resellerRefId,
            api_key_id: req.user.api_key_id || null,
            kode_produk: product.kode_produk,
            nama_produk: product.nama,
            tujuan: tujuan,
            server_id: server_id || null,
            harga: finalResellerPrice,
            subtotal: product.harga_jual,
            payment_method: "reseller_wallet",
            payment_status: "paid",
            status: "processing"
        }]);

        if (insertErr) {
            console.error("Gagal simpan order reseller:", insertErr);
            // Refund kembali saldo karena kegagalan insert
            await walletService.refundWallet({
                userId,
                amount: finalResellerPrice,
                referenceId: `REFUND-INS-${orderId}`,
                originalOrderId: orderId,
                reason: "Gagal membuat baris pesanan reseller di database"
            });
            return res.status(500).json({
                success: false,
                message: "Gagal memproses pesanan di sistem internal"
            });
        }

        // 5. Teruskan transaksi ke Provider TokoVoucher
        let tvResult = null;
        let finalStatus = "processing";
        try {
            tvResult = await tokovoucher.createTransaction({
                refId: orderId,
                kodeProduk: product.kode_produk,
                tujuan: tujuan,
                serverId: server_id || undefined
            });

            if (tvResult.status === 0 || tvResult.status === "0") {
                finalStatus = "gagal";
                // Refund otomatis jika TokoVoucher menolak langsung
                await walletService.refundWallet({
                    userId,
                    amount: finalResellerPrice,
                    referenceId: `REFUND-TV0-${orderId}`,
                    originalOrderId: orderId,
                    reason: tvResult.error_msg || tvResult.message || "Ditolak oleh provider TokoVoucher"
                });
            } else {
                finalStatus = TOKOVOUCHER_STATUS_MAP[tvResult.status] || "processing";
            }

            await supabase.from("topup_orders").update({
                status: finalStatus,
                tv_ref_id: tvResult.ref_id || orderId,
                tv_trx_id: tvResult.trx_id || null,
                tv_sn: tvResult.sn || null,
                tv_message: tvResult.error_msg || tvResult.message || null,
                updated_at: new Date().toISOString()
            }).eq("id", orderId);

        } catch (tvErr) {
            console.error("TokoVoucher API error (dianggap pending):", tvErr.message);
            await supabase.from("topup_orders").update({
                status: "processing",
                tv_message: "Menunggu konfirmasi provider TokoVoucher",
                updated_at: new Date().toISOString()
            }).eq("id", orderId);
        }

        sendTelegramNotification(
            `🚀 <b>Order Reseller API Baru</b>\nReseller: ${req.user.fullname || req.user.email}\nRef ID: ${resellerRefId}\nProduk: ${product.nama}\nTujuan: ${tujuan}\nHarga: ${rupiahLog(finalResellerPrice)}`
        );

        res.status(201).json({
            success: true,
            message: finalStatus === "sukses" ? "Pesanan berhasil diselesaikan" : "Pesanan diterima dan sedang diproses",
            data: {
                order_id: orderId,
                ref_id: resellerRefId,
                status: finalStatus === "sukses" ? "SUCCESS" : (finalStatus === "gagal" ? "FAILED" : "PROCESSING"),
                kode_produk: product.kode_produk,
                nama_produk: product.nama,
                target: tujuan,
                server_id: server_id || null,
                price: finalResellerPrice,
                serial_number: tvResult?.sn || null,
                message: tvResult?.message || tvResult?.error_msg || "Pesanan sedang diproses",
                balance_remaining: debitResult.balance_after,
                created_at: new Date().toISOString()
            }
        });

    } catch (err) {
        console.error("reseller createOrder error:", err);
        res.status(500).json({
            success: false,
            message: err.message || "Server Error"
        });
    }
};

/**
 * GET /api/v1/reseller/orders/:id
 * Cek status pesanan reseller berdasarkan order_id atau ref_id
 */
exports.getOrderStatus = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        const { data: order, error } = await supabase
            .from("topup_orders")
            .select("id, reseller_ref_id, kode_produk, nama_produk, tujuan, server_id, harga, status, tv_sn, tv_message, created_at, updated_at")
            .eq("reseller_user_id", userId)
            .or(`id.eq.${id},reseller_ref_id.eq.${id}`)
            .maybeSingle();

        if (error || !order) {
            return res.status(404).json({
                success: false,
                message: `Pesanan dengan ID/Ref '${id}' tidak ditemukan`
            });
        }

        let normalizedStatus = "PROCESSING";
        if (order.status === "sukses") normalizedStatus = "SUCCESS";
        else if (order.status === "gagal" || order.status === "failed") normalizedStatus = "FAILED";

        res.json({
            success: true,
            data: {
                order_id: order.id,
                ref_id: order.reseller_ref_id,
                status: normalizedStatus,
                kode_produk: order.kode_produk,
                nama_produk: order.nama_produk,
                target: order.tujuan,
                server_id: order.server_id,
                price: Number(order.harga),
                serial_number: order.tv_sn || null,
                message: order.tv_message || (normalizedStatus === "SUCCESS" ? "Transaksi Berhasil" : "Sedang diproses"),
                created_at: order.created_at,
                updated_at: order.updated_at
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Gagal memuat status pesanan" });
    }
};

/**
 * GET /api/v1/reseller/balance
 * Cek sisa saldo wallet reseller & informasi tier
 */
exports.getBalance = async (req, res) => {
    const userId = req.user.id;
    try {
        const wallet = await walletService.getOrCreateWallet(userId, "RESELLER_WALLET");
        const konteksReseller = await getResellerContext(userId);

        res.json({
            success: true,
            data: {
                balance: wallet.balance,
                currency: wallet.currency,
                tier: konteksReseller.tier?.name || "GOLD",
                discount_percent: konteksReseller.discountPercent,
                reseller_status: req.user.reseller_status || "approved"
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Gagal memuat saldo reseller" });
    }
};

/**
 * GET /api/v1/reseller/products
 * Daftar katalog produk beserta harga modal khusus reseller
 */
exports.getProducts = async (req, res) => {
    const userId = req.user.id;
    try {
        const { data: products, error } = await supabase
            .from("topup_products")
            .select("kode_produk, nama, kategori, source_operator_name, harga_beli, harga_jual, butuh_server_id, is_active")
            .eq("is_active", true)
            .order("kategori", { ascending: true });

        if (error) throw error;

        const konteksReseller = await getResellerContext(userId);
        const discountPercent = konteksReseller.discountPercent || 3.5;

        const formatted = (products || []).map(p => {
            let basePrice = Number(p.harga_jual) || 0;
            if (basePrice <= 0) {
                basePrice = hitungMarkupWajar(p.harga_beli || 0, p.kategori, p.source_operator_name);
            }
            const { harga: resellerPrice, hemat } = hitungHargaReseller(basePrice, p.harga_beli || 0, discountPercent);

            return {
                kode_produk: p.kode_produk,
                nama: p.nama,
                kategori: p.kategori,
                operator: p.source_operator_name || p.kategori,
                harga_normal: basePrice,
                harga_reseller: resellerPrice,
                diskon_persen: discountPercent,
                hemat: hemat,
                butuh_server_id: !!p.butuh_server_id,
                status: "ACTIVE"
            };
        });

        res.json({
            success: true,
            total: formatted.length,
            data: formatted
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Gagal memuat daftar produk reseller" });
    }
};

/**
 * POST /api/v1/reseller/check-nickname
 * Validasi ID/Server akun game pelanggan sebelum checkout
 */
exports.checkNickname = async (req, res) => {
    const { kode_game, user_id, zone_id } = req.body;
    if (!kode_game || !user_id) {
        return res.status(400).json({
            success: false,
            message: "Field 'kode_game' dan 'user_id' wajib diisi"
        });
    }

    try {
        const result = await checkNickname(kode_game, user_id, zone_id);
        if (!result || !result.success) {
            return res.status(400).json({
                success: false,
                message: result?.message || "Akun game tidak ditemukan atau format ID salah"
            });
        }

        res.json({
            success: true,
            data: {
                username: result.username || result.name || "Player",
                user_id: user_id,
                zone_id: zone_id || null
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Gagal memeriksa nickname akun" });
    }
};
