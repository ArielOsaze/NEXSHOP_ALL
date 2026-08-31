const crypto = require("crypto");
const supabase = require("../config/db");
const walletService = require("../services/walletService");
const tokovoucher = require("../config/tokovoucher");
const { getResellerContext } = require("../services/resellerService");
const { fetchAllRows } = require("../utils/supabasePaginate");
const { filterSellablePortalProducts, formatPortalProduct } = require("../services/resellerCatalogService");
// BUG FIX: hitungMarkupWajar TIDAK diekspor oleh utils/resellerPricing --
// dia ada di utils/topupHelpers. Impor lama bikin nilainya undefined,
// jadi tiap produk yang harga_jual-nya kosong/0 melempar
// "hitungMarkupWajar is not a function" dan endpoint balas 500.
const { hitungHargaReseller } = require("../utils/resellerPricing");
const { hitungMarkupWajar } = require("../utils/topupHelpers");
const { sendTelegramNotification } = require("../config/telegram");
const { dispatchResellerWebhook } = require("../services/resellerWebhookService");

function rupiahLog(n) {
    return "Rp " + Number(n || 0).toLocaleString("id-ID");
}
const apigames = require("../config/apigames");

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

    // ==========================================================
    // VALIDASI INPUT
    // Endpoint ini memotong saldo sungguhan, jadi tiap field yang masuk
    // ke query/ledger dibatasi bentuk & panjangnya di sini -- bukan
    // diserahkan ke lapisan bawah. Sebelumnya nilai apa pun (termasuk
    // string sepanjang megabyte atau berisi karakter filter PostgREST)
    // diteruskan begitu saja.
    // ==========================================================
    const kodeProduk = String(kode_produk).trim();
    const tujuanBersih = String(tujuan).trim();
    const serverIdBersih = server_id == null || String(server_id).trim() === "" ? null : String(server_id).trim();

    if (kodeProduk.length > 60 || !/^[A-Za-z0-9._-]+$/.test(kodeProduk)) {
        return res.status(400).json({ success: false, message: "Format 'kode_produk' tidak valid." });
    }
    if (tujuanBersih.length < 2 || tujuanBersih.length > 60 || !/^[A-Za-z0-9._@-]+$/.test(tujuanBersih)) {
        return res.status(400).json({ success: false, message: "Format 'tujuan' tidak valid (2-60 karakter alfanumerik)." });
    }
    if (serverIdBersih !== null && (serverIdBersih.length > 30 || !/^[A-Za-z0-9._-]+$/.test(serverIdBersih))) {
        return res.status(400).json({ success: false, message: "Format 'server_id' tidak valid." });
    }

    // ref_id ikut masuk ke reference_id ledger wallet (kunci idempotency),
    // jadi bentuknya harus ketat dan tidak boleh kosong-tapi-whitespace.
    const resellerRefId = ref_id != null && String(ref_id).trim()
        ? String(ref_id).trim()
        : `REF-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

    if (resellerRefId.length > 80 || !/^[A-Za-z0-9._-]+$/.test(resellerRefId)) {
        return res.status(400).json({
            success: false,
            message: "Format 'ref_id' tidak valid (maksimal 80 karakter: huruf, angka, '.', '-', '_')."
        });
    }

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
            .eq("kode_produk", kodeProduk)
            .eq("is_active", true)
            .maybeSingle();

        if (prodErr || !product) {
            return res.status(404).json({
                success: false,
                message: `Produk dengan kode '${kodeProduk}' tidak ditemukan atau sedang tidak aktif`
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

        if (product.butuh_server_id && !serverIdBersih) {
            return res.status(400).json({
                success: false,
                message: "Produk ini memerlukan 'server_id' (Zone ID / Server ID)"
            });
        }

        // 3. Potong saldo reseller secara atomik
        //
        // BUG FIX (idempotency): referensi debit dulu berisi Date.now(),
        // sehingga SETIAP percobaan menghasilkan reference_id baru. Dua
        // request bersamaan dengan ref_id yang sama karena itu sama-sama
        // lolos pengecekan duplikat di langkah 1 (cek-lalu-insert tidak
        // atomik) dan sama-sama memotong saldo -- reseller dipotong dua
        // kali untuk satu pesanan. Referensi sekarang DITURUNKAN penuh dari
        // (user, ref_id) supaya UNIQUE constraint di wallet_transactions
        // .reference_id yang menjadi penjaga idempotency-nya: percobaan
        // kedua dijawab "sudah pernah diproses" tanpa memindahkan uang.
        const debitRef = `RSL-PUR-${userId}-${resellerRefId}`;
        let debitResult;
        try {
            debitResult = await walletService.debitWallet({
                userId,
                type: "RESELLER_PURCHASE",
                amount: finalResellerPrice,
                referenceId: debitRef,
                externalTransactionId: resellerRefId,
                description: `Reseller API: Pembelian ${product.nama} (${tujuanBersih})`,
                metadata: {
                    reseller_ref_id: resellerRefId,
                    kode_produk: product.kode_produk,
                    target: tujuanBersih,
                    server_id: serverIdBersih
                }
            });
        } catch (walletErr) {
            const code = walletErr.code === walletService.WALLET_NOT_SETUP_CODE
                ? walletService.WALLET_NOT_SETUP_CODE
                : "INSUFFICIENT_RESELLER_BALANCE";
            const status = walletErr.status || (code === "INSUFFICIENT_RESELLER_BALANCE" ? 402 : 400);
            return res.status(status).json({
                success: false,
                code,
                message: walletErr.message || "Saldo deposit reseller tidak mencukupi untuk melakukan transaksi ini"
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
            tujuan: tujuanBersih,
            server_id: serverIdBersih,
            harga: finalResellerPrice,
            subtotal: product.harga_jual,
            payment_method: "reseller_wallet",
            payment_status: "paid",
            status: "processing"
        }]);

        if (insertErr) {
            // 23505 = tabrakan UNIQUE INDEX idx_topup_orders_reseller_ref
            // (reseller_user_id, reseller_ref_id). Artinya request kembar
            // sedang/sudah membuat pesanan yang SAMA -- pesanannya sah, dan
            // debit-nya sudah di-dedup lewat debitRef deterministik di atas.
            //
            // PENTING: jangan refund di sini. Versi sebelumnya mengembalikan
            // dana pada kasus ini, padahal saldo cuma terpotong sekali --
            // jadi refund-nya MENCIPTAKAN uang dari ketiadaan setiap kali
            // ada request kembar.
            if (String(insertErr.code) === "23505") {
                const { data: kembar } = await supabase
                    .from("topup_orders")
                    .select("id, status, kode_produk, nama_produk, tujuan, server_id, harga, tv_sn, created_at")
                    .eq("reseller_user_id", userId)
                    .eq("reseller_ref_id", resellerRefId)
                    .maybeSingle();

                if (kembar) {
                    return res.status(200).json({
                        success: true,
                        idempotent: true,
                        message: "Pesanan dengan ref_id ini sudah pernah dibuat sebelumnya",
                        data: {
                            order_id: kembar.id,
                            ref_id: resellerRefId,
                            status: kembar.status === "sukses" ? "SUCCESS" : (kembar.status === "gagal" ? "FAILED" : "PROCESSING"),
                            kode_produk: kembar.kode_produk,
                            nama_produk: kembar.nama_produk,
                            target: kembar.tujuan,
                            server_id: kembar.server_id,
                            price: Number(kembar.harga),
                            serial_number: kembar.tv_sn || null,
                            balance_remaining: await walletService.getWalletBalance(userId),
                            created_at: kembar.created_at
                        }
                    });
                }
            }

            console.error("Gagal simpan order reseller:", insertErr);
            // Kegagalan insert yang sesungguhnya: pesanan tidak pernah ada,
            // jadi dana yang sudah dipotong wajib dikembalikan.
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
                tujuan: tujuanBersih,
                serverId: serverIdBersih || undefined
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

        // Kirim status awal (SUCCESS/FAILED/PROCESSING) ke Webhook URL yang
        // diatur reseller di Partner Portal. Jika masih PROCESSING, perubahan
        // final berikutnya dikirim oleh rekonsiliasi webhook TokoVoucher.
        dispatchResellerWebhook({
            id: orderId,
            user_id: userId,
            reseller_user_id: userId,
            reseller_ref_id: resellerRefId,
            kode_produk: product.kode_produk,
            nama_produk: product.nama,
            tujuan: tujuanBersih,
            server_id: serverIdBersih,
            harga: finalResellerPrice,
            status: finalStatus,
            tv_sn: tvResult?.sn || null,
            tv_message: tvResult?.message || tvResult?.error_msg || "Pesanan sedang diproses"
        }).catch((webhookErr) => {
            console.log("Gagal mengirim webhook awal reseller:", webhookErr.message);
        });

        sendTelegramNotification(
            `🚀 <b>Order Reseller API Baru</b>\nReseller: ${req.user.fullname || req.user.email}\nRef ID: ${resellerRefId}\nProduk: ${product.nama}\nTujuan: ${tujuanBersih}\nHarga: ${rupiahLog(finalResellerPrice)}`
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
                target: tujuanBersih,
                server_id: serverIdBersih,
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
        // KEAMANAN: `id` datang dari URL dan dulu ditempel mentah ke dalam
        // string filter .or(). Sintaks filter PostgREST memakai koma dan
        // tanda kurung sebagai pemisah, jadi nilai seperti
        //   "x,reseller_user_id.gt.0"
        // menyuntikkan kondisi tambahan ke dalam query. Karakter di luar
        // pola order id / ref id yang sah ditolak lebih dulu.
        const lookupId = String(id || "").trim();
        if (!lookupId || lookupId.length > 80 || !/^[A-Za-z0-9_-]+$/.test(lookupId)) {
            return res.status(400).json({
                success: false,
                message: "Format order_id / ref_id tidak valid (hanya huruf, angka, '-' dan '_')."
            });
        }

        const { data: order, error } = await supabase
            .from("topup_orders")
            .select("id, reseller_ref_id, kode_produk, nama_produk, tujuan, server_id, harga, status, tv_sn, tv_message, created_at, updated_at")
            .eq("reseller_user_id", userId)
            .or(`id.eq.${lookupId},reseller_ref_id.eq.${lookupId}`)
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
                // Nilai apa adanya. Fallback lama ("GOLD" / "approved")
                // melaporkan tier & status yang tidak pernah dimiliki akun.
                tier: konteksReseller.tier ? konteksReseller.tier.name : null,
                tier_code: konteksReseller.tier ? konteksReseller.tier.code : null,
                discount_percent: Number(konteksReseller.discountPercent) || 0,
                reseller_status: req.user.reseller_status || null
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
        const allRows = await fetchAllRows((from, to) =>
            supabase
                .from("topup_products")
                .select("id, kode_produk, nama, kategori, source_operator_name, harga_beli, harga_jual, butuh_server_id, is_active, source_status, operator_logo, item_icon")
                .eq("is_active", true)
                .order("kategori", { ascending: true })
                .order("harga_jual", { ascending: true })
                .order("id", { ascending: true })
                .range(from, to)
        );

        const konteksReseller = await getResellerContext(userId);
        if (String(req.user.reseller_status || "").toLowerCase() === "approved" && !konteksReseller.isReseller) {
            return res.status(503).json({ success: false, code: "RESELLER_PRICING_UNAVAILABLE", message: "Tier reseller belum tersedia" });
        }
        const discountPercent = Number(konteksReseller.discountPercent) || 0;
        const formatted = filterSellablePortalProducts(allRows).map((product) => {
            const portalProduct = formatPortalProduct(product, konteksReseller);
            return {
                kode_produk: portalProduct.kode_produk,
                nama: portalProduct.nama,
                kategori: portalProduct.kategori,
                operator: portalProduct.operator,
                harga_normal: portalProduct.harga_normal,
                harga_reseller: portalProduct.harga_modal_reseller,
                diskon_persen: discountPercent,
                hemat: portalProduct.hemat,
                butuh_server_id: portalProduct.butuh_server_id,
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
    const { kode_game, user_id, zone_id } = req.body || {};
    const kategori = String(kode_game || "").trim().toLowerCase();
    const tujuan = String(user_id || "").trim();
    const serverId = zone_id == null || String(zone_id).trim() === ""
        ? null
        : String(zone_id).trim();

    if (!kategori || !tujuan) {
        return res.status(400).json({
            success: false,
            code: "INVALID_REQUEST",
            message: "Field 'kode_game' dan 'user_id' wajib diisi"
        });
    }
    if (kategori.length > 40 || tujuan.length > 60 || (serverId && serverId.length > 30)) {
        return res.status(400).json({
            success: false,
            code: "INVALID_REQUEST",
            message: "Format input terlalu panjang"
        });
    }

    try {
        // ApiGames menerima kategori dan target sebagai object. Kode dengan
        // tanda hubung (mobile-legends/free-fire) dinormalisasi oleh adapter.
        const result = await apigames.checkNickname({
            kategori,
            tujuan,
            serverId
        });

        if (result?.reason === "provider_unavailable" || result?.reason === "service_not_configured") {
            return res.status(503).json({
                success: false,
                code: "NICKNAME_PROVIDER_UNAVAILABLE",
                message: "Layanan cek nickname sedang tidak tersedia"
            });
        }
        if (!result?.available) {
            return res.status(400).json({
                success: false,
                code: "UNSUPPORTED_GAME",
                message: "Kode game belum didukung untuk cek nickname"
            });
        }
        if (!result.is_valid) {
            return res.status(422).json({
                success: false,
                code: "INVALID_GAME_ACCOUNT",
                message: "User ID atau Zone ID tidak valid",
                data: {
                    kode_game: kategori,
                    user_id: tujuan,
                    zone_id: serverId,
                    username: null
                }
            });
        }

        return res.json({
            success: true,
            message: "Nickname berhasil ditemukan",
            data: {
                kode_game: kategori,
                user_id: tujuan,
                zone_id: serverId,
                username: result.username
            }
        });
    } catch (err) {
        console.error("Reseller check nickname error:", err.message);
        return res.status(502).json({
            success: false,
            code: "NICKNAME_PROVIDER_ERROR",
            message: "Provider cek nickname gagal merespons"
        });
    }
};
