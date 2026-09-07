"use strict";

function firstPresent(...values) {
    return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

/**
 * Correlate the server-to-server iPaymu status response with the invoice that
 * was named by the callback. A paid status by itself is not enough: the
 * gateway transaction must be for this exact reference and amount.
 */
function verifyIpaymuTransactionForTopup(transaction, topup, callbackTransactionId) {
    const remoteReference = firstPresent(
        transaction?.ReferenceId,
        transaction?.referenceId,
        transaction?.reference_id
    );
    const expectedReference = String(topup?.id || "").trim();
    if (!expectedReference || String(remoteReference || "").trim() !== expectedReference) {
        return { ok: false, code: "IPAYMU_REFERENCE_MISMATCH" };
    }

    const remoteAmount = Number(firstPresent(transaction?.Amount, transaction?.amount));
    const expectedAmount = Number(topup?.amount);
    if (!Number.isFinite(remoteAmount) || !Number.isFinite(expectedAmount) || remoteAmount !== expectedAmount) {
        return { ok: false, code: "IPAYMU_AMOUNT_MISMATCH" };
    }

    const expectedTransactionId = String(topup?.ipaymu_trx_id || "").trim();
    const callbackId = String(callbackTransactionId || "").trim();
    if (expectedTransactionId && callbackId !== expectedTransactionId) {
        return { ok: false, code: "IPAYMU_TRANSACTION_MISMATCH" };
    }

    const responseTransactionId = firstPresent(
        transaction?.TransactionId,
        transaction?.transactionId,
        transaction?.transaction_id,
        transaction?.TrxId,
        transaction?.trx_id
    );
    if (responseTransactionId && callbackId && String(responseTransactionId).trim() !== callbackId) {
        return { ok: false, code: "IPAYMU_TRANSACTION_MISMATCH" };
    }

    return { ok: true };
}

module.exports = { verifyIpaymuTransactionForTopup };
