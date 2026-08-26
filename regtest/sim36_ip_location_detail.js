"use strict";

const assert = require("assert");
const {
    buildLoginSecurityMessage,
    getClientIp,
    lookupIpLocation
} = require("../nexshop-backend/services/userNotificationHelpers");

(async () => {
    const location = await lookupIpLocation("8.8.8.8", async (url) => ({
        ok: true,
        json: async () => ({
            ip: "8.8.8.8",
            success: true,
            continent: "North America",
            country: "United States",
            country_code: "US",
            region: "California",
            city: "San Jose",
            postal: "95113",
            latitude: 37.3361663,
            longitude: -121.8905913,
            connection: { asn: 15169, org: "Google LLC", isp: "Google LLC", domain: "google.com" },
            timezone: { id: "America/Los_Angeles", abbr: "PDT", utc: "-07:00" }
        })
    }));

    assert.equal(location.city, "San Jose");
    assert.equal(location.region, "California");
    assert.equal(location.country, "United States");
    assert.equal(location.postal, "95113");
    assert.equal(location.latitude, 37.3361663);
    assert.equal(location.longitude, -121.8905913);
    assert.equal(location.isp, "Google LLC");
    assert.equal(location.asn, "AS15169");
    assert.equal(location.timezone, "America/Los_Angeles");

    const message = buildLoginSecurityMessage({
        user: { fullname: "Ariel", email: "ariel@example.com" },
        timestamp: new Date("2026-08-27T00:00:00.000Z"),
        ip: "8.8.8.8",
        location,
        userAgent: "Mozilla/5.0 Chrome/139 Windows",
        resetUrl: "https://nexshop.cloud/#/forgot-password"
    });
    assert.match(message, /Kota: San Jose/);
    assert.match(message, /Wilayah: California/);
    assert.match(message, /Negara: United States \(US\)/);
    assert.match(message, /Kode pos: 95113/);
    assert.match(message, /Koordinat perkiraan: 37\.3361663, -121\.8905913/);
    assert.match(message, /https:\/\/www\.google\.com\/maps\?q=37\.3361663,-121\.8905913/);
    assert.match(message, /ISP: Google LLC/);
    assert.match(message, /ASN: AS15169/);
    assert.match(message, /Zona waktu: America\/Los_Angeles/);
    assert.match(message, /bukan GPS presisi/i);

    assert.equal(getClientIp({ ip: "203.0.113.10", headers: { "x-forwarded-for": "1.1.1.1" } }), "203.0.113.10");

    let fallbackCalls = 0;
    const fallbackLocation = await lookupIpLocation("1.1.1.1", async (url) => {
        fallbackCalls += 1;
        if (fallbackCalls === 1) return { ok: false, json: async () => ({}) };
        return {
            ok: true,
            json: async () => ({ city: "Sydney", region: "New South Wales", country_name: "Australia", country_code: "AU", latitude: -33.859336, longitude: 151.203624, timezone: "Australia/Sydney", utc_offset: "+1000", asn: "AS13335", org: "Cloudflare, Inc." })
        };
    });
    assert.equal(fallbackLocation.source, "ipapi.co");
    assert.equal(fallbackLocation.city, "Sydney");
    assert.equal(fallbackLocation.asn, "AS13335");
    console.log("sim36_ip_location_detail: passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
