/* CSP-safe replacement for legacy inline handlers. No eval/new Function. */
(function(){
  "use strict";
  const staticHandlers={
"h01372c08e6bdc5": function(event) {
editorialToggleAll(this.checked)
},
"h01a496bc6667c2": function(event) {
editorialSave('publish')
},
"h023f0ab6927a9e": function(event) {
renderCmdKResults()
},
"h059a287923a538": function(event) {
provisionWaApiManager()
},
"h09396a5406e394": function(event) {
savePromoCode()
},
"h0a5a82aa568e3b": function(event) {
toggleSidebar()
},
"h0a767897a96027": function(event) {
switchConsoleView('view-deposit')
},
"h0b2ac0e2611b54": function(event) {
bulkMarkupTopupPrice()
},
"h0bb821393f5987": function(event) {
editorialLoadArticles(1)
},
"h0c25a4462c8d8e": function(event) {
handleSaveProfile(event)
},
"h0c43c7b8e4d7cc": function(event) {
filterOperatorGrid()
},
"h0d946258cf7080": function(event) {
filterPortalProducts()
},
"h0f338aafe14091": function(event) {
saveContentSettings()
},
"h11d2affc1b3ede": function(event) {
toggleMasterMusicPlayer(this.checked)
},
"h14271c1308e277": function(event) {
logout()
},
"h1488b7f3132b91": function(event) {
handleTopSpenderSubmit(event)
},
"h16077839f03913": function(event) {
applyToFilter('activate')
},
"h18ee31b2a3e36d": function(event) {
downloadPriceListPerLevel('json')
},
"h1b2c35d69e50fa": function(event) {
handleDepositSubmit(event)
},
"h1bbbc75be633df": function(event) {
smartActivateAllTopup()
},
"h1c4ad0f6f0d9a3": function(event) {
selectProductCategory('Voucher Data', this)
},
"h1cc2233fdb565e": function(event) {
saveProduct()
},
"h1db4f74b559949": function(event) {
editInsertBlock('blockquote')
},
"h1f582852b261cb": function(event) {
filterPortalOrders()
},
"h21681cf5786377": function(event) {
bulkSetTopupButuhServerId(true)
},
"h2208345317e758": function(event) {
sendWaApiManagerTest()
},
"h2470867054c99e": function(event) {
setDepositPreset(100000)
},
"h2490f33302f64f": function(event) {
openProductModal()
},
"h24f25a7b763944": function(event) {
selectPaymentMethod('mandiri')
},
"h263c44d693bf1d": function(event) {
selectProductCategory('Paket Data', this)
},
"h28097c0cc3eb83": function(event) {
editorialSlugManual()
},
"h2827069f666bf1": function(event) {
testFonnteWhatsApp()
},
"h2ae2a7309f6460": function(event) {
resetDepositView()
},
"h2b12f537564bbb": function(event) {
resetAiConfigModal()
},
"h2c66eea11f40ff": function(event) {
testSingleAiProvider('groq')
},
"h324faf94132fba": function(event) {
submitTvDeposit()
},
"h33f66a62c3a2a2": function(event) {
setProductDisplayMode('table')
},
"h373653e602c3e6": function(event) {
selectPaymentMethod('qris')
},
"h37a42970c29ca5": function(event) {
removeKtpFile(event)
},
"h39a7b72f8a5ad3": function(event) {
openChangeAdminPinModal()
},
"h39d8dba00050a1": function(event) {
editInsertBlock('h3')
},
"h3a7a9b8e160e7b": function(event) {
switchConsoleView('view-tiers')
},
"h3b7415eb00ba86": function(event) {
saveStoreSettings()
},
"h3c669b33755a18": function(event) {
openRequestProductModal()
},
"h3c768efc9077c5": function(event) {
setDepositPreset(50000)
},
"h3f7855d2a007d0": function(event) {
toggleSecretKey()
},
"h414f06af13142c": function(event) {
loadResellerApplications()
},
"h418593bacad755": function(event) {
loadNotifications()
},
"h42371c20a487f7": function(event) {
savePromo()
},
"h4261a9d3014b12": function(event) {
resetWaApiManagerSession()
},
"h42ec357ab384ee": function(event) {
exportOrdersCsv()
},
"h4309e6fbb968ac": function(event) {
switchConsoleView('view-products')
},
"h43ae37cd3128e8": function(event) {
editorialLoadArticles(1)
},
"h469961b2187869": function(event) {
deleteAiApiKeyFromModal()
},
"h48a276985ce401": function(event) {
copyValue('inputApiKey', 'API Key')
},
"h49a6af107b4ead": function(event) {
saveKnowledge()
},
"h4a823296e2ff34": function(event) {
loadTopupProducts()
},
"h4aa1d36417eec6": function(event) {
toggleShowApiKey()
},
"h4c422f43cdb530": function(event) {
resendAdminPinChangeOtp()
},
"h503492bbc7e131": function(event) {
setDepositPreset(250000)
},
"h511eb8cd57edca": function(event) {
return false;
},
"h5480af943110d8": function(event) {
toggleAiProvider('openrouter', this.checked)
},
"h565fef13a99a44": function(event) {
switchAuthTab('register')
},
"h59a25f87474c3b": function(event) {
loadApprovals()
},
"h5ca2054967bf19": function(event) {
openPromoModal()
},
"h5cc908ee9a4a7a": function(event) {
toggleAiProvider('groq', this.checked)
},
"h5dd33df62539b2": function(event) {
editorialPreviewImage()
},
"h5e0b8c186c73c9": function(event) {
addFaqRow()
},
"h5f7f7a35929ee5": function(event) {
editFmt('italic')
},
"h5face8aaf28d4d": function(event) {
changeCatalogPage(1)
},
"h60e4708a71f0a0": function(event) {
revealApiKeys()
},
"h612421649f1dc7": function(event) {
closePortalPurchase()
},
"h65c58d0d57aab5": function(event) {
event.preventDefault(); saveAiApiKeyFromModal();
},
"h698df5b284faa8": function(event) {
editorialAutoSlug()
},
"h6c6f7eea0f4606": function(event) {
openCustomTestimonialModal()
},
"h6dd0b0864eb093": function(event) {
loadAiInsights()
},
"h6df6860044a3f8": function(event) {
switchConsoleView('view-dashboard')
},
"h6e92cc64303240": function(event) {
editorialChangePage(1)
},
"h6fa11e263cfbbd": function(event) {
refreshWaQr()
},
"h71b64e39019e18": function(event) {
openApiKeyModal('groq', 'Groq AI', 'openai/gpt-oss-20b')
},
"h72d00c95940cba": function(event) {
loadAdminRatings(1)
},
"h72e83eb11aa8de": function(event) {
testAiConnectionFromModal()
},
"h73a13c16e768e2": function(event) {
switchView('topup')
},
"h742325cf3d0114": function(event) {
loadResellerAll()
},
"h7646d8b2aa5cc0": function(event) {
editFmt('insertOrderedList')
},
"h794cb54cfc0d21": function(event) {
editInsertBlock('h2')
},
"h7a6422d974f27d": function(event) {
setDepositPreset(500000)
},
"h7c176691fe78bd": function(event) {
selectProductCategory('Topup Game', this)
},
"h7fa7a76ec7787a": function(event) {
selectProductCategory('Telpon & SMS', this)
},
"h821403350e707c": function(event) {
unlockLoginIp()
},
"h8214c7dba2b8e1": function(event) {
bulkSetTopupStatus(false)
},
"h856a2e450acc39": function(event) {
forceWaRescan()
},
"h8775898a0bac59": function(event) {
selectProductCategory('E-Money', this)
},
"h87f35682d87b64": function(event) {
loadProducts()
},
"hwaSyncVerifiedContacts": function(event) {
 syncVerifiedContactsToWaApi(event)
},
"h8939b0441258e0": function(event) {
onAiModelSelectChange(this.value)
},
"h89b9a45cdc4c92": function(event) {
saveMusic()
},
"h89c7bd9e768148": function(event) {
testSingleAiProvider('gemini')
},
"h8a13282b7d814a": function(event) {
downloadPriceListPerLevel('csv')
},
"h8a1e561c650096": function(event) {
loadMultiAiLogs()
},
"h8b9c7b5fe9ae50": function(event) {
editorialOpenCreate()
},
"h8e4b05496b3752": function(event) {
editFmt('bold')
},
"h8f235f3f967794": function(event) {
editorialChangePage(-1)
},
"h8f36729d8c367b": function(event) {
openApiKeyModal('openrouter', 'OpenRouter', 'meta-llama/llama-3.3-70b-instruct')
},
"h90feacea1087ce": function(event) {
logoutAdminNow()
},
"h91204c809b2f45": function(event) {
loadStats()
},
"h91294453ca2c3a": function(event) {
refreshWaApiManagerStatus()
},
"h91dfee8af64336": function(event) {
saveMascotSettings()
},
"h927a153ad98805": function(event) {
testAllAiProviders()
},
"h93d7cd270efc97": function(event) {
keepAdminSessionAlive()
},
"h941a242d6ca3d5": function(event) {
setProductDisplayMode('grid')
},
"h9499b9134d8993": function(event) {
switchAuthTab('login')
},
"h968940245fccff": function(event) {
loadTopupOrders()
},
"h96e7e4bdbca023": function(event) {
createWaCampaign()
},
"h97c31caad6d751": function(event) {
cancelDepositQris()
},
"h98774214921044": function(event) {
submitAdminPinChangeStep()
},
"h9987f116dca7ef": function(event) {
applyToFilter('auto-markup')
},
"h9b620934467e68": function(event) {
openTopSpenderModal()
},
"h9b8277ca2c40b8": function(event) {
testApiGames()
},
"h9d7b111fd7a8e5": function(event) {
bulkAutoMarkupTopupPrice()
},
"h9d976891a466d3": function(event) {
openCmdKModal()
},
"h9e4fe246a7997c": function(event) {
editorialDebouncedLoad()
},
"ha152c5410ba9df": function(event) {
copySelectedSecret()
},
"ha229ee4b3ca7a1": function(event) {
document.getElementById('pcProductPicker').classList.toggle('d-none', this.value !== 'specific')
},
"ha3899dfd608bc6": function(event) {
provisionWaGateway()
},
"ha653325c41a73d": function(event) {
selectProductCategory('all', this)
},
"ha6a778a50133b9": function(event) {
switchConsoleView('view-api')
},
"ha94f61d1195080": function(event) {
toggleAiProvider('gemini', this.checked)
},
"hac655637af018c": function(event) {
setDepositPreset(1000000)
},
"hafa84800d93dad": function(event) {
selectProductCategory('Voucher Game', this)
},
"hb10d6602cce09c": function(event) {
openTvDepositModal()
},
"hb3f7b870353303": function(event) {
editorialAddSource()
},
"hb4744e4d1aa9ef": function(event) {
previewMascotSettings()
},
"hb55daf710860dd": function(event) {
saveCustomTestimonial()
},
"hb6f9bdcff8a1d7": function(event) {
editorialSave('draft')
},
"hba2c2a885092fe": function(event) {
syncFullCatalog()
},
"hba2dd665f04b3a": function(event) {
loadPortalOverview()
},
"hbc9a56d167bf8d": function(event) {
selectProductCategory('Hiburan', this)
},
"hbfa606b7630c87": function(event) {
saveProfile()
},
"hbfb007ef721d9d": function(event) {
applyToFilter('deactivate')
},
"hc1e43f1961beb6": function(event) {
runWaMarketingNow()
},
"hc31100a74cd72c": function(event) {
bulkSmartActivateTopup()
},
"hc31f5a4165988a": function(event) {
bulkSetTopupButuhServerId(false)
},
"hc38956a0be0b68": function(event) {
editFmt('underline')
},
"hc4c3be16456284": function(event) {
selectProductCategory('Pulsa', this)
},
"hc5c69e80b90cb4": function(event) {
saveAiApiKeyFromModal()
},
"hc6160872bb8d8a": function(event) {
openCategoryMapModal()
},
"hcce0dd2284e2f5": function(event) {
logoutReseller()
},
"hd0e0acc4842d4d": function(event) {
testSingleAiProvider('openrouter')
},
"hd10855d8220de1": function(event) {
editFmt('insertUnorderedList')
},
"hd315f3540e4b0c": function(event) {
redoTopupAction()
},
"hd318210572f861": function(event) {
changeCatalogPage(-1)
},
"hd3bc24ef73d335": function(event) {
loadWaCampaignData()
},
"hd65fd754ee2351": function(event) {
applyToFilter('server-id-on')
},
"hd8182f238ba67f": function(event) {
loadWaApiManager(true)
},
"hd8e9d2ff38a3d1": function(event) {
loadMultiAiLogs()
},
"hd99225f17a9b48": function(event) {
openApiKeyModal('gemini', 'Google Gemini', 'gemini-flash-latest')
},
"hdb0850b6f1f4c1": function(event) {
openPromoCodeModal()
},
"hdb2f646a369ae2": function(event) {
loadWhatsAppContacts()
},
"hdbaed16f27aecb": function(event) {
switchConsoleView('view-mutations')
},
"hdc7df47cdf7f85": function(event) {
openMusicModal()
},
"hddddf2a4f63ed3": function(event) {
submitAdminPin()
},
"hdf29ce5d4fd4ec": function(event) {
undoTopupAction()
},
"hdf827f5c7cf5ce": function(event) {
applyToFilter('server-id-off')
},
"he018e584361444": function(event) {
lewatiGerbangPin()
},
"he139e555d192a8": function(event) {
editorialBulkAction('publish')
},
"he1669569159197": function(event) {
changeRatingPage(-1)
},
"he19e8f7cdfa81c": function(event) {
retryAdminGate()
},
"he290ec30b4f180": function(event) {
editInsertLink()
},
"he31fc1c6af40f3": function(event) {
editorialBulkAction('delete')
},
"he32fa5cc66632f": function(event) {
saveRuntimeConfig()
},
"he510f479a72e58": function(event) {
loadMultiAiStatus()
},
"he620e4e5448e33": function(event) {
selectPaymentMethod('bca')
},
"he6a7823da8b7b4": function(event) {
downloadProductsExcel()
},
"he7aefd9973f5a7": function(event) {
editorialBulkAction('unpublish')
},
"heab951fe02998c": function(event) {
changeRatingPage(1)
},
"headbbf48b7e842": function(event) {
copyValue('inputSecretKey', 'Secret Key')
},
"heb24272fa8d33c": function(event) {
switchConsoleView('view-settings')
},
"heeba3c62ed0ede": function(event) {
copyApiKeyToClipboard()
},
"hef400965d43f2c": function(event) {
window.scrollTo({top:0,behavior:'smooth'});return false;
},
"hf00afb8aa27eac": function(event) {
editInsertHr()
},
"hf1d9f6322ad0b7": function(event) {
selectProductCategory('Transfer Dana', this)
},
"hf23691673e0142": function(event) {
withAdminPin(loadPendingOtp, 'memuat OTP')
},
"hf558750beef1b1": function(event) {
selectProductCategory('Pascabayar', this)
},
"hf925e23477acec": function(event) {
saveApiKeys()
},
"hfa7f2a8bb6ef25": function(event) {
testWhatsApp()
},
"hfbb7981a685bf3": function(event) {
selectProductCategory('PLN', this)
},
"hff03fa2c1bdaf8": function(event) {
switchConsoleView('view-transactions')
},
"hff9a4c205d8e11": function(event) {
bulkSetTopupStatus(true)
}
  };
  function decodeQuoted(token) {
    const q = token[0];
    let body = token.slice(1, -1);
    body = body.replace(/\\([\\'"\nrt])/g, (_, c) => ({n:"\n",r:"\r",t:"\t"}[c] || c));
    return body;
  }
  function splitArgs(source) {
    const out = []; let start = 0; let depth = 0; let quote = null; let esc = false;
    for (let i=0; i<source.length; i += 1) {
      const c = source[i];
      if (quote) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === quote) quote = null; continue; }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
      if ("([{".includes(c)) depth += 1;
      else if (")]}".includes(c)) depth -= 1;
      else if (c === "," && depth === 0) { out.push(source.slice(start, i).trim()); start = i + 1; }
    }
    if (source.slice(start).trim()) out.push(source.slice(start).trim());
    return out;
  }
  function atom(token, event, element) {
    if (token === "this") return element;
    if (token === "event") return event;
    if (/^this\.[A-Za-z_$][\w$]*$/.test(token)) return element[token.slice(6)];
    if (token === "true") return true; if (token === "false") return false;
    if (token === "null") return null; if (token === "undefined") return undefined;
    if (/^["'`][\s\S]*["'`]$/.test(token)) return decodeQuoted(token);
    if (/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) return Number(token);
    return undefined;
  }
  function invokeDynamic(body, event, element) {
    const code = body.trim().replace(/;$/, "").trim();
    if (code === "return false") return false;
    let m = code.match(/^([A-Za-z_$][\w$]*)\s*\((.*)\)$/s);
    if (m) {
      const fn = globalThis[m[1]];
      if (typeof fn !== "function") return undefined;
      const args = splitArgs(m[2]).map((x) => atom(x, event, element));
      if (args.some((x, i) => x === undefined && splitArgs(m[2])[i] !== "undefined")) return undefined;
      return fn.apply(element, args);
    }
    m = code.match(/^([A-Za-z_$][\w$]*)\[(\d+)\]\.([A-Za-z_$][\w$]*)\s*=\s*this\.([A-Za-z_$][\w$]*)$/);
    if (m && globalThis[m[1]] && globalThis[m[1]][Number(m[2])]) { globalThis[m[1]][Number(m[2])][m[3]] = element[m[4]]; return undefined; }
    m = code.match(/^document\.getElementById\((['"])(.*?)\1\)\.([A-Za-z_$][\w$]*)\s*=\s*(.*)$/s);
    if (m) { const target = document.getElementById(m[2]); const value = atom(m[4].trim(), event, element); if (target && value !== undefined) target[m[3]] = value; return undefined; }
    m = code.match(/^this\.outerHTML\s*=\s*(['"])([\s\S]*)\1$/);
    if (m) { element.outerHTML = decodeQuoted(m[1]+m[2]+m[1]); return undefined; }
    return undefined;
  }
  function bind() {
    document.querySelectorAll("*[data-csp-onclick],*[data-csp-onchange],*[data-csp-oninput],*[data-csp-onsubmit],*[data-csp-onkeyup],*[data-csp-onkeydown],*[data-csp-onload],*[data-csp-onerror]").forEach((element) => {
      Array.from(element.attributes).filter((attr) => attr.name.startsWith("data-csp-on")).forEach((attr) => {
        const eventName = attr.name.slice("data-csp-on".length);
        const boundKey = `cspBound${eventName}`;
        if (element.dataset[boundKey] === "1") return;
        element.dataset[boundKey] = "1";
        element.addEventListener(eventName, (event) => {
          const handler = staticHandlers[attr.value];
          const result = handler ? handler.call(element, event) : invokeDynamic(attr.value, event, element);
          if (result === false) event.preventDefault();
        });
      });
    });
  }
  let observerStarted = false;
  function startObserver() {
    if (observerStarted || !window.MutationObserver) return;
    observerStarted = true;
    new MutationObserver(bind).observe(document.documentElement, { childList: true, subtree: true });
  }
  function init() { bind(); startObserver(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true }); else init();
})();
