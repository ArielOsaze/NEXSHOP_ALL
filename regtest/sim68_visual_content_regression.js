const assert = require("node:assert/strict");

const BASE = process.env.NEXSHOP_BASE_URL || "https://nexshop.cloud";

async function get(path, options = {}) {
    const response = await fetch(new URL(path, BASE), {
        redirect: "follow",
        ...options,
        headers: { "user-agent": "NexShop-safe-visual-regression/1.0", ...(options.headers || {}) }
    });
    const body = await response.text();
    return { response, body };
}

async function headImage(url) {
    const response = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        headers: { "user-agent": "NexShop-safe-visual-regression/1.0" }
    });
    const contentType = response.headers.get("content-type") || "";
    assert.equal(response.ok, true, `image asset failed: ${new URL(url).hostname} (${response.status})`);
    assert.match(contentType, /^image\//, `asset is not an image: ${new URL(url).hostname} (${contentType})`);
    return new URL(url).hostname;
}

(async () => {
    const [{ response: homeResponse, body: home }, { response: adminResponse, body: admin }, { response: cssResponse, body: adminCss }, { response: cspResponse, body: csp }] = await Promise.all([
        get("/"),
        get("/admin/dashboard"),
        get("/admin/css/style.css?v=20260829-visual-regression-1"),
        get("/", { method: "HEAD" })
    ]);

    assert.equal(homeResponse.status, 200);
    assert.equal(adminResponse.status, 200);
    assert.equal(cssResponse.status, 200);
    assert.match(home, /id="news" aria-labelledby="newsTitle"/);
    assert.match(home, /id="testimonials" aria-labelledby="testimonialsTitle"/);
    assert.match(home, /script\.js\?v=20260829-visual-regression-2/);
    assert.match(home, /inline-styles\.css\?v=20260829-visual-regression-1/);
    assert.match(admin, /dashboard\.js\?v=20260829-visual-regression-1/);
    assert.match(admin, /style\.css\?v=20260829-visual-regression-1/);
    assert.match(adminCss, /#view-products #products > tr > td:nth-child\(2\) img/);
    assert.match(adminCss, /#view-promo #promoSlides > tr > td:nth-child\(2\) img/);
    assert.match(adminCss, /#view-ratings #customTestimonialsTbody > tr > td:first-child img/);

    const policy = cspResponse.headers.get("content-security-policy") || csp;
    const imgSource = (policy.match(/img-src[^;]*/) || [""])[0];
    const allowedHosts = new Set(imgSource.split(/\s+/).slice(1));
    assert.equal(allowedHosts.has("https://cauklmkpjwsdwqoazqlx.supabase.co"), true);

    const newsResult = await get("/api/news/articles?limit=9");
    assert.equal(newsResult.response.status, 200);
    const newsJson = JSON.parse(newsResult.body);
    const news = Array.isArray(newsJson.data) ? newsJson.data : [];
    assert.ok(news.length > 0, "public news API returned no articles");

    const promoResult = await get("/api/promo");
    assert.equal(promoResult.response.status, 200);
    const promos = JSON.parse(promoResult.body);
    assert.ok(Array.isArray(promos) && promos.length > 0, "public promo API returned no slides");

    const testimonialsResult = await get("/api/ratings/public/testimonials?limit=20");
    assert.equal(testimonialsResult.response.status, 200);
    const testimonials = JSON.parse(testimonialsResult.body);
    assert.ok(Array.isArray(testimonials) && testimonials.length > 0, "public testimonial API returned no ratings");

    const imageUrls = [
        ...news.map((item) => item.image_url),
        ...promos.flatMap((item) => [item.image_url, item.mobile_image_url]),
        ...testimonials.map((item) => item.avatar)
    ].filter(Boolean);
    const uniqueImageUrls = [...new Set(imageUrls)];
    const hosts = [...new Set(uniqueImageUrls.map((url) => new URL(url).hostname))];
    for (const host of hosts) {
        assert.ok(allowedHosts.has(`https://${host}`), `CSP img-src missing live image host: ${host}`);
    }
    await Promise.all(uniqueImageUrls.map(headImage));

    console.log(`PASS sim68: homepage content, public news/testimonial/promo data, CSP image hosts, asset responses, dan admin thumbnail guard (${uniqueImageUrls.length} images).`);
})().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
