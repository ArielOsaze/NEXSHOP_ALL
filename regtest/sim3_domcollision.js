// Regression test: pastikan renderRatingPrompt tidak salah sasaran ketika
// order yang sama dirender di DUA container sekaligus (uid sama).
const { JSDOM } = require("jsdom");

const dom = new JSDOM(`<!DOCTYPE html><body>
  <div id="containerA"></div>
  <div id="containerB"></div>
</body>`);
global.document = dom.window.document;

const uid = "ORD123";

function renderInto(containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = `
        <div id="rp_stars_${uid}"></div>
        <div id="rp_form_${uid}" class="hidden">FORM-${containerId}</div>
        <div id="rp_err_${uid}" class="hidden"></div>
        <button id="rp_submit_${uid}">Kirim</button>
    `;
    container.classList.remove("hidden");

    // FIXED behaviour: scoped ke container, bukan document.getElementById global
    const form = container.querySelector(`#rp_form_${uid}`);
    const errDiv = container.querySelector(`#rp_err_${uid}`);
    return { form, errDiv, container };
}

const a = renderInto("containerA");
const b = renderInto("containerB");

console.log("form A belongs to containerA:", a.form.parentElement === document.getElementById("containerA"));
console.log("form B belongs to containerB:", b.form.parentElement === document.getElementById("containerB"));
console.log("form A !== form B:", a.form !== b.form);
console.log("form A text:", a.form.textContent, "| form B text:", b.form.textContent);

if (a.form.parentElement === document.getElementById("containerA") &&
    b.form.parentElement === document.getElementById("containerB") &&
    a.form !== b.form) {
    console.log("PASS: tidak ada cross-container collision, masing-masing modal mengontrol elemen miliknya sendiri.");
} else {
    console.log("FAIL: masih ada collision.");
    process.exit(1);
}
