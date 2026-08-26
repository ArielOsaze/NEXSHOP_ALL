const crypto = require("crypto");
const supabase = require("../config/db");
const walletService = require("../services/walletService");
const { createRedirectPayment, checkTransactionStatus, createDirectPayment, isDirectPaymentMethod } = require("../config/ipaymu");
const { sendTelegramNotification } = require("../config/telegram");

function rupiahLog(n) {
    return "Rp " + Number(n || 0).toLocaleString("id-ID");
}

const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:3000").replace(/\/$/, "");
const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");

const IPAYMU_TOPUP_METHODS = Object.freeze({
    qris: "qris",
    va: "va",
    bca: "va",
    mandiri: "va",
    bni: "va",
    bri: "va",
    cimb: "va",
    bsi: "va",
    cstore: "cstore",
    indomaret: "cstore",
    alfamart: "cstore"
});

/**
 * GET /api/wallet/me
 * Informasi saldo dompet user & ringkasan mutasi
 */
exports.getMyWallet = async (req, res) => {
    try {
        const wallet = await walletService.getOrCreateWallet(req.user.id);
        const { transactions, total } = await walletService.getWalletMutations(req.user.id, { limit: 5 });

        res.json({
            wallet: {
                id: wallet.id,
                balance: wallet.balance,
                currency: wallet.currency,
                status: wallet.status,
                wallet_type: wallet.wallet_type
            },
            recent_transactions: transactions,
            total_transactions: total
        });
    } catch (err) {
        if (err.code === walletService.WALLET_NOT_SETUP_CODE) {
            return res.status(503).json({
                message: err.message,
                code: err.code
            });
        }
        console.error("getMyWallet error:", err);
        res.status(500).json({ message: err.message || "Gagal memuat informasi dompet" });
    }
};

/**
 * GET /api/wallet/mutations
 * Riwayat mutasi saldo dengan paginasi
 */
exports.getMutations = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const offset = (page - 1) * limit;
        const type = req.query.type ? String(req.query.type).toUpperCase() : null;

        const { transactions, total } = await walletService.getWalletMutations(req.user.id, {
            limit,
            offset,
            type
        });

        res.json({
            page,
            limit,
            total,
            total_pages: Math.ceil(total / limit),
            transactions
        });
    } catch (err) {
        if (err.code === walletService.WALLET_NOT_SETUP_CODE) {
            return res.status(503).json({ message: err.message, code: err.code });
        }
        res.status(500).json({ message: "Gagal memuat riwayat mutasi dompet" });
    }
};

/**
 * POST /api/wallet/topup
 * Buat invoice top up saldo melalui gateway resmi iPaymu
 */
exports.createTopup = async (req, res) => {
    const rawAmount = req.body.amount;
    const paymentMethod = String(req.body.payment_method || "qris").toLowerCase().trim();
    const paymentChannel = req.body.payment_channel ? String(req.body.payment_channel).toLowerCase().trim() : undefined;

    const amount = parseInt(rawAmount, 10);
    if (!amount || isNaN(amount) || amount < 10000) {
        return res.status(400).json({ message: "Nominal topup minimal Rp 10.000" });
    }
    if (amount > 10000000) {
        return res.status(400).json({ message: "Nominal topup maksimal Rp 10.000.000 per transaksi" });
    }

    try {
        const wallet = await walletService.getOrCreateWallet(req.user.id);
        const topupId = "WT" + crypto.randomBytes(10).toString("hex").toUpperCase();

        const ipaymuMethod = IPAYMU_TOPUP_METHODS[paymentMethod] || "qris";
        const isDirect = isDirectPaymentMethod(ipaymuMethod);

        // Ambil info user
        const { data: user } = await supabase
            .from("users")
            .select("id, email, fullname, whatsapp")
            .eq("id", req.user.id)
            .maybeSingle();

        const buyerName = user?.fullname || req.user.fullname || "User NexShop";
        const buyerEmail = user?.email || req.user.email || "user@nexshop.id";
        let buyerPhone = user?.whatsapp || "08123456789";
        if (buyerPhone.startsWith("62")) buyerPhone = "0" + buyerPhone.substring(2);

        // Simpan baris wallet_topups status PENDING
        const { error: insertErr } = await supabase.from("wallet_topups").insert([{
            id: topupId,
            user_id: req.user.id,
            wallet_id: wallet.id,
            amount: amount,
            fee: 0,
            total: amount,
            payment_method: paymentMethod,
            payment_channel: paymentChannel || null,
            status: "PENDING"
        }]);

        if (insertErr) {
            if (walletService.isWalletMissing(insertErr)) {
                throw new walletService.WalletNotSetupError();
            }
            throw insertErr;
        }

        let paymentData;
        const notifyUrl = `${BACKEND_URL}/api/wallet/notification`;

        if (isDirect) {
            try {
                const directRes = await createDirectPayment({
                    referenceId: topupId,
                    amount: amount,
                    buyerName,
                    buyerEmail,
                    buyerPhone,
                    paymentMethod: ipaymuMethod,
                    paymentChannel: paymentChannel || (ipaymuMethod === "qris" ? "qris" : "bni"),
                    notifyUrl
                });

                paymentData = {
                    is_direct: true,
                    transaction_id: directRes.transactionId,
                    payment_no: directRes.paymentNo,
                    qr_content: directRes.qrContent,
                    qr_image: directRes.qrImage,
                    expired: directRes.expired,
                    payment_url: directRes.url
                };

                await supabase.from("wallet_topups").update({
                    ipaymu_trx_id: directRes.transactionId,
                    payment_no: directRes.paymentNo,
                    qr_content: directRes.qrContent,
                    payment_expired: directRes.expired,
                    payment_url: directRes.url
                }).eq("id", topupId);
            } catch (dirErr) {
                console.log("Direct payment topup failed, fallback to redirect:", dirErr.message);
                // Fallback ke redirect
                const redirRes = await createRedirectPayment({
                    referenceId: topupId,
                    itemDetails: [{ name: `Top Up Saldo NexShop (Rp ${amount.toLocaleString('id-ID')})`, price: amount, quantity: 1 }],
                    buyerName,
                    buyerEmail,
                    buyerPhone,
                    returnUrl: `${FRONTEND_URL}/marketplace?topup=${topupId}&status=success`,
                    cancelUrl: `${FRONTEND_URL}/marketplace?topup=${topupId}&status=cancel`,
                    notifyUrl,
                    paymentMethod: ipaymuMethod
                });

                paymentData = {
                    is_direct: false,
                    session_id: redirRes.sessionId,
                    payment_url: redirRes.paymentUrl
                };

                await supabase.from("wallet_topups").update({
                    ipaymu_session_id: redirRes.sessionId,
                    payment_url: redirRes.paymentUrl
                }).eq("id", topupId);
            }
        } else {
            const redirRes = await createRedirectPayment({
                referenceId: topupId,
                itemDetails: [{ name: `Top Up Saldo NexShop (Rp ${amount.toLocaleString('id-ID')})`, price: amount, quantity: 1 }],
                buyerName,
                buyerEmail,
                buyerPhone,
                returnUrl: `${FRONTEND_URL}/marketplace?topup=${topupId}&status=success`,
                cancelUrl: `${FRONTEND_URL}/marketplace?topup=${topupId}&status=cancel`,
                notifyUrl,
                paymentMethod: ipaymuMethod
            });

            paymentData = {
                is_direct: false,
                session_id: redirRes.sessionId,
                payment_url: redirRes.paymentUrl
            };

            await supabase.from("wallet_topups").update({
                ipaymu_session_id: redirRes.sessionId,
                payment_url: redirRes.paymentUrl
            }).eq("id", topupId);
        }

        res.status(201).json({
            message: "Invoice topup berhasil dibuat",
            topup_id: topupId,
            amount: amount,
            ...paymentData
        });
    } catch (err) {
        if (err.code === walletService.WALLET_NOT_SETUP_CODE) {
            return res.status(503).json({ message: err.message, code: err.code });
        }
        console.error("createTopup error:", err);
        res.status(500).json({ message: err.message || "Gagal memproses pembuatan tagihan topup iPaymu" });
    }
};

/**
 * GET /api/wallet/topup/:id
 * Cek status invoice top up
 */
exports.getTopupStatus = async (req, res) => {
    const { id } = req.params;
    try {
        const { data: topup, error } = await supabase
            .from("wallet_topups")
            .select("*")
            .eq("id", id)
            .eq("user_id", req.user.id)
            .maybeSingle();

        if (error || !topup) {
            return res.status(404).json({ message: "Invoice top up tidak ditemukan" });
        }

        res.json({
            id: topup.id,
            amount: Number(topup.amount),
            status: topup.status,
            payment_method: topup.payment_method,
            payment_no: topup.payment_no,
            qr_content: topup.qr_content,
            payment_url: topup.payment_url,
            created_at: topup.created_at,
            updated_at: topup.updated_at
        });
    } catch (err) {
        res.status(500).json({ message: "Gagal memuat status top up" });
    }
};

/**
 * POST /api/wallet/notification
 * Webhook resmi dari server iPaymu untuk topup saldo
 * Idempotent & Server-to-Server verified
 */
exports.handleIpaymuWalletNotification = async (req, res) => {
    try {
        const body = req.body || {};
        const referenceId = body.reference_id || body.referenceId;
        const trxId = body.trx_id || body.trxId;

        if (!referenceId) {
            return res.status(400).json({ message: "reference_id tidak ada di body notifikasi" });
        }

        // Cek apakah invoice topup ada di database
        const { data: topup, error: topupErr } = await supabase
            .from("wallet_topups")
            .select("*")
            .eq("id", referenceId)
            .maybeSingle();

        if (topupErr || !topup) {
            return res.status(404).json({ message: "Invoice topup tidak ditemukan" });
        }

        // Idempotency: Jika invoice sudah PAID, jangan lakukan apa-apa
        if (topup.status === "PAID") {
            return res.status(200).json({ message: "OK (Already PAID)" });
        }

        // Verifikasi Ulang Langsung ke Server iPaymu (Server-to-Server)
        let verifiedStatus = null;
        if (trxId) {
            try {
                const trx = await checkTransactionStatus(trxId);
                verifiedStatus = String(trx.Status || trx.status || "").toLowerCase();
            } catch (verifyErr) {
                console.log("Gagal verifikasi status topup ke iPaymu:", verifyErr.message);
            }
        }

        if (!verifiedStatus) {
            return res.status(200).json({ message: "Diterima, menunggu verifikasi iPaymu" });
        }

        const isPaid = ["berhasil", "success", "1", "paid", "settlement"].includes(verifiedStatus);

        if (isPaid) {
            // 1. Eksekusi penambahan saldo secara atomik ke ledger wallet
            const creditResult = await walletService.creditWallet({
                userId: topup.user_id,
                type: "TOPUP",
                amount: topup.amount,
                referenceId: topup.id,
                externalTransactionId: String(trxId || ""),
                description: `Topup Saldo via iPaymu (${topup.payment_method.toUpperCase()})`,
                metadata: {
                    topup_id: topup.id,
                    ipaymu_trx_id: trxId,
                    payment_method: topup.payment_method
                }
            });

            // 2. Tandai status invoice menjadi PAID
            await supabase
                .from("wallet_topups")
                .update({
                    status: "PAID",
                    ipaymu_trx_id: trxId || topup.ipaymu_trx_id,
                    updated_at: new Date().toISOString()
                })
                .eq("id", topup.id);

            // 3. Kirim notifikasi Telegram & WA
            sendTelegramNotification(
                `💰 <b>Top Up Saldo Berhasil</b>\nInvoice: ${topup.id}\nUser ID: ${topup.user_id}\nNominal: ${rupiahLog(topup.amount)}\nSaldo Baru: ${rupiahLog(creditResult.balance_after)}`
            );

            return res.status(200).json({ message: "Topup saldo berhasil diproses" });
        } else if (["gagal", "expired", "cancel", "cancelled", "-1", "failed"].includes(verifiedStatus)) {
            await supabase
                .from("wallet_topups")
                .update({ status: "FAILED", updated_at: new Date().toISOString() })
                .eq("id", topup.id);
            return res.status(200).json({ message: "Status topup diperbarui (gagal/expired)" });
        }

        res.status(200).json({ message: "Status pending" });
    } catch (err) {
        console.error("handleIpaymuWalletNotification error:", err);
        res.status(500).json({ message: err.message || "Server Error" });
    }
};

/**
 * GET /api/wallet/admin/wallets
 * Admin: Daftar seluruh wallet pengguna & reseller
 */
exports.adminGetWallets = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
        const offset = (page - 1) * limit;
        const search = req.query.search ? String(req.query.search).trim() : null;

        let query = supabase
            .from("wallets")
            .select(`
                id,
                user_id,
                wallet_type,
                balance,
                currency,
                status,
                created_at,
                updated_at,
                users ( id, email, fullname, whatsapp, role, reseller_status )
            `, { count: "exact" })
            .order("balance", { ascending: false })
            .range(offset, offset + limit - 1);

        const { data, count, error } = await query;

        if (error) {
            if (walletService.isWalletMissing(error)) {
                return res.status(503).json({ message: "Fitur wallet belum di-setup di database", code: "WALLET_NOT_SETUP" });
            }
            throw error;
        }

        res.json({
            page,
            limit,
            total: count || 0,
            total_pages: Math.ceil((count || 0) / limit),
            wallets: data || []
        });
    } catch (err) {
        console.error("adminGetWallets error:", err);
        res.status(500).json({ message: "Gagal memuat daftar dompet" });
    }
};

/**
 * GET /api/wallet/admin/ledger
 * Admin: Daftar seluruh mutasi ledger transaksi wallet
 */
exports.adminGetLedger = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
        const offset = (page - 1) * limit;
        const type = req.query.type ? String(req.query.type).toUpperCase() : null;
        const userId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;

        let query = supabase
            .from("wallet_transactions")
            .select(`
                id,
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
                metadata,
                created_at,
                users ( id, email, fullname )
            `, { count: "exact" })
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);

        if (type) query = query.eq("type", type);
        if (userId) query = query.eq("user_id", userId);

        const { data, count, error } = await query;

        if (error) {
            if (walletService.isWalletMissing(error)) {
                return res.status(503).json({ message: "Fitur wallet belum di-setup di database", code: "WALLET_NOT_SETUP" });
            }
            throw error;
        }

        res.json({
            page,
            limit,
            total: count || 0,
            total_pages: Math.ceil((count || 0) / limit),
            transactions: data || []
        });
    } catch (err) {
        console.error("adminGetLedger error:", err);
        res.status(500).json({ message: "Gagal memuat ledger mutasi dompet" });
    }
};

/**
 * POST /api/wallet/admin/adjust
 * Admin: Penyesuaian saldo manual (ADMIN_ADJUSTMENT) dengan audit log
 */
exports.adminAdjustBalance = async (req, res) => {
    const { user_id, amount, direction, reason } = req.body;
    const adminId = req.user.id;

    const parsedUserId = parseInt(user_id, 10);
    const parsedAmount = parseFloat(amount);
    const normalizedDirection = String(direction || "").toUpperCase();

    if (!parsedUserId || !parsedAmount || parsedAmount <= 0 || !["IN", "OUT"].includes(normalizedDirection)) {
        return res.status(400).json({ message: "Parameter user_id, amount (>0), dan direction (IN/OUT) wajib valid" });
    }

    if (!reason || String(reason).trim().length < 5) {
        return res.status(400).json({ message: "Alasan penyesuaian (reason) wajib diisi minimal 5 karakter" });
    }

    try {
        const adjustRef = `ADJ-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
        let result;

        if (normalizedDirection === "IN") {
            result = await walletService.creditWallet({
                userId: parsedUserId,
                type: "ADMIN_ADJUSTMENT",
                amount: parsedAmount,
                referenceId: adjustRef,
                description: `Penyesuaian Saldo oleh Admin: ${reason}`,
                metadata: {
                    admin_id: adminId,
                    admin_email: req.user.email,
                    reason: String(reason).trim()
                }
            });
        } else {
            result = await walletService.debitWallet({
                userId: parsedUserId,
                type: "ADMIN_ADJUSTMENT",
                amount: parsedAmount,
                referenceId: adjustRef,
                description: `Pengurangan Saldo oleh Admin: ${reason}`,
                metadata: {
                    admin_id: adminId,
                    admin_email: req.user.email,
                    reason: String(reason).trim()
                }
            });
        }

        sendTelegramNotification(
            `🛠 <b>Admin Wallet Adjustment</b>\nTarget User ID: ${parsedUserId}\nArah: ${normalizedDirection === "IN" ? "Penambahan Saldo (+)" : "Pengurangan Saldo (-)"}\nNominal: ${rupiahLog(parsedAmount)}\nAlasan: ${reason}\nSaldo Baru: ${rupiahLog(result.balance_after)}\nAdmin: ${req.user.email}`
        );

        res.json({
            success: true,
            message: `Berhasil melakukan penyesuaian saldo sebesar ${rupiahLog(parsedAmount)}`,
            balance_after: result.balance_after,
            reference_id: adjustRef
        });
    } catch (err) {
        console.error("adminAdjustBalance error:", err);
        res.status(500).json({ message: err.message || "Gagal melakukan penyesuaian saldo" });
    }
};

/**
 * POST /api/wallet/admin/refund-order
 * Admin: Refund manual pesanan ke saldo wallet user
 */
exports.adminRefundOrder = async (req, res) => {
    const { order_id, reason } = req.body;
    const adminId = req.user.id;

    if (!order_id) {
        return res.status(400).json({ message: "order_id wajib diisi" });
    }

    try {
        const { data: order, error: orderErr } = await supabase
            .from("topup_orders")
            .select("*")
            .eq("id", order_id)
            .maybeSingle();

        if (orderErr || !order) {
            return res.status(404).json({ message: "Pesanan tidak ditemukan" });
        }

        if (!order.user_id) {
            return res.status(400).json({ message: "Pesanan dilakukan oleh guest (tanpa akun), tidak dapat refund ke dompet" });
        }

        if (order.refunded_at) {
            return res.status(400).json({ message: "Pesanan ini sudah pernah di-refund sebelumnya" });
        }

        const refundRef = `RF-ADM-${order.id}-${Date.now()}`;
        const refundResult = await walletService.refundWallet({
            userId: order.user_id,
            amount: order.harga,
            referenceId: refundRef,
            originalOrderId: order.id,
            reason: reason || `Manual refund oleh admin (${req.user.email})`
        });

        await supabase.from("topup_orders").update({
            status: "gagal",
            refunded_at: new Date().toISOString(),
            tv_message: `Refund oleh admin: ${reason || "Pesanan dibatalkan"}`
        }).eq("id", order.id);

        sendTelegramNotification(
            `↩️ <b>Admin Manual Order Refund</b>\nOrder ID: ${order.id}\nUser ID: ${order.user_id}\nNominal: ${rupiahLog(order.harga)}\nAlasan: ${reason || "Dibatalkan Admin"}\nAdmin: ${req.user.email}`
        );

        res.json({
            success: true,
            message: `Pesanan ${order.id} berhasil di-refund ke dompet user`,
            refund_amount: Number(order.harga),
            balance_after: refundResult.balance_after
        });
    } catch (err) {
        console.error("adminRefundOrder error:", err);
        res.status(500).json({ message: err.message || "Gagal memproses refund pesanan" });
    }
};
