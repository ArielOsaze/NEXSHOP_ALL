const fs = require('fs');

// 1. Fix HTML
let html = fs.readFileSync('nexshop-frontend/index.html', 'utf8');
html = html.replace(/href="\/one-stop"/g, 'href="#"');

// Add an ID to the desktop nav link if it doesn't have one
if (!html.includes('id="headerOneStopBtn"')) {
    html = html.replace('>One Stop Solution</a>', ' id="headerOneStopBtn">One Stop Solution</a>');
}
fs.writeFileSync('nexshop-frontend/index.html', html);

// 2. Fix JS
let js = fs.readFileSync('nexshop-frontend/script.js', 'utf8');

const navLogic = `
function openOneStopView(e) {
    if (e) e.preventDefault();
    
    // Hide other views
    document.getElementById("topupGameGrid").classList.add("hidden");
    document.getElementById("topupSearchFilter").classList.add("hidden");
    document.getElementById("topupDetail").classList.add("hidden");
    document.getElementById("topup").classList.remove("hidden");
    
    // Show One Stop
    const oneStopView = document.getElementById("view-onestop");
    if (oneStopView) {
        oneStopView.classList.remove("hidden");
        // Trigger reveal animation
        setTimeout(() => oneStopView.classList.add("revealed"), 50);
    }
    
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeOneStopView() {
    const oneStopView = document.getElementById("view-onestop");
    if (oneStopView) oneStopView.classList.add("hidden");
    
    document.getElementById("topup").classList.remove("hidden");
    document.getElementById("topupGameGrid").classList.remove("hidden");
    document.getElementById("topupSearchFilter").classList.remove("hidden");
    document.getElementById("topupDetail").classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", () => {
    const headerBtn = document.getElementById("headerOneStopBtn");
    if (headerBtn) headerBtn.addEventListener("click", openOneStopView);
    
    const menuBtn = document.getElementById("menuOneStopBtn");
    if (menuBtn) {
        menuBtn.addEventListener("click", (e) => {
            openOneStopView(e);
            const mobileMenuOverlay = document.getElementById('mobileMenuOverlay');
            if (mobileMenuOverlay) mobileMenuOverlay.classList.remove('active');
        });
    }
});
`;

if (!js.includes('openOneStopView')) {
    js += '\n' + navLogic;
    fs.writeFileSync('nexshop-frontend/script.js', js);
}

console.log("Fixed HTML and JS routing for One Stop");
