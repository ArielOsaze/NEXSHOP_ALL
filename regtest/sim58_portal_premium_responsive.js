"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const file = path.join(root, "nexshop-frontend", "portal-reseller.html");
const html = fs.readFileSync(file, "utf8");

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to >= 0, `section ${start} sampai ${end} harus ada`);
  return source.slice(from, to);
}

const settings = between(html, '<div id="view-settings"', '<div id="view-api"');
const profileClose = settings.indexOf('</form>');
const setupForm = settings.indexOf('<form id="formTwoFactorSetup"');
assert(profileClose >= 0 && setupForm >= 0 && profileClose < setupForm,
  "Form profil harus ditutup sebelum form 2FA dimulai; nested form membuat setup 2FA gagal");
const setupStart = settings.indexOf('<form id="formTwoFactorSetup"');
const setupEnd = settings.indexOf('</form>', setupStart);
assert(setupStart >= 0 && setupEnd > setupStart && !settings.slice(setupStart, setupEnd).includes('id="formTwoFactorEnable"'),
  "Form enable 2FA tidak boleh bersarang di form setup");

for (const requiredId of [
  "sectionAuth", "authPaneLogin", "authPaneRegister", "formResellerLogin", "formResellerRegister",
  "portalTwoFactorChallenge", "formTwoFactorVerify", "formTwoFactorSetup", "formTwoFactorEnable", "formTwoFactorDisable"
]) {
  assert(html.includes(`id="${requiredId}"`), `ID ${requiredId} harus tetap dipertahankan`);
}

for (const marker of [
  "tv-auth-layout", "tv-auth-intro", "tv-auth-card", "tv-auth-trust-list",
  "Identitas portal terpisah", "TOTP 2FA opsional", "Review KYC transparan"
]) {
  assert(html.includes(marker), `premium auth marker ${marker} harus ada`);
}

for (const marker of [
  "--tv-surface-base: #08090a", "--tv-accent-indigo: #7170ff",
  ".tv-nav-link:focus-visible", ".tv-auth-layout", "@media (max-width: 640px)",
  "grid-template-columns: 1fr !important"
]) {
  assert(html.includes(marker), `responsive/pro design marker ${marker} harus ada`);
}

assert(/\.tv-auth-tabs[\s\S]{0,260}@media/.test(html) || html.includes(".tv-auth-tabs"),
  "tab auth harus punya class agar dapat responsive treatment");

console.log("PASS sim58: portal form valid, auth premium, dan mobile grid aman");
