(() => {
    "use strict";

    function normalizePhone(rawPhone) {
        let clean = String(rawPhone || "").replace(/[^0-9]/g, "");
        if (clean.startsWith("62")) return clean;
        if (!clean.startsWith("0") && clean.length > 5) clean = `0${clean}`;
        return clean;
    }

    function getIdentity(user) {
        return {
            authenticated: Boolean(user),
            name: String(user?.fullname || user?.name || "").trim(),
            email: String(user?.email || "").trim(),
            phone: normalizePhone(user?.phone_normalized || user?.phone || "")
        };
    }

    function fieldWrapper(input, wrapperSelector) {
        if (!input) return null;
        return input.closest(wrapperSelector) || input.parentElement;
    }

    function toggleCheckoutIdentityFields({ user, emailId, phoneId, wrapperSelector = ".tw-field-group" }) {
        const identity = getIdentity(user);
        const emailInput = document.getElementById(emailId);
        const phoneInput = document.getElementById(phoneId);
        const emailWrap = fieldWrapper(emailInput, wrapperSelector);
        const phoneWrap = fieldWrapper(phoneInput, wrapperSelector);

        [
            [emailInput, emailWrap, identity.email],
            [phoneInput, phoneWrap, identity.phone]
        ].forEach(([input, wrapper, value]) => {
            if (!input) return;
            if (identity.authenticated) {
                input.value = value;
                input.required = false;
                input.readOnly = true;
                wrapper?.classList.add("hidden");
            } else {
                input.value = "";
                input.required = true;
                input.readOnly = false;
                wrapper?.classList.remove("hidden");
            }
        });

        return identity;
    }

    // QRCode.js renders a tight canvas. Add an explicit white quiet zone when
    // exporting so the downloaded PNG always contains the complete QR edges.
    function createPaddedQrDataUrl(sourceCanvas, padding = 32) {
        if (!sourceCanvas || !sourceCanvas.width || !sourceCanvas.height) return null;
        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = sourceCanvas.width + padding * 2;
        exportCanvas.height = sourceCanvas.height + padding * 2;
        const context = exportCanvas.getContext("2d");
        if (!context) return null;
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
        context.imageSmoothingEnabled = false;
        context.drawImage(sourceCanvas, padding, padding);
        return exportCanvas.toDataURL("image/png");
    }

    window.NexShopCheckoutHelpers = Object.freeze({
        getIdentity,
        normalizePhone,
        toggleCheckoutIdentityFields,
        createPaddedQrDataUrl
    });
})();
