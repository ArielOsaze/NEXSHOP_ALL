const { JSDOM } = require("jsdom");
const dom = new JSDOM(`<!DOCTYPE html><body>
  <div id="containerA"></div>
  <div id="containerB"></div>
</body>`);
global.document = dom.window.document;
const uid = "ORD123";

function renderInto_OLD_BUGGY(containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = `<div id="rp_form_${uid}" class="hidden">FORM-${containerId}</div>`;
    // OLD (buggy) behaviour: global document.getElementById
    const form = document.getElementById(`rp_form_${uid}`);
    return { form };
}

const a = renderInto_OLD_BUGGY("containerA");
const b = renderInto_OLD_BUGGY("containerB");

console.log("(OLD CODE) form A === form B ?", a.form === b.form, "-> text:", a.form.textContent);
if (a.form === b.form) {
    console.log("CONFIRMED: kode lama memang collision -- keduanya nunjuk ke elemen yang sama (milik containerB, yg terakhir render).");
}
