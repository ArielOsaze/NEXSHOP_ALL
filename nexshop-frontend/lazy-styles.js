/* Promote intentionally non-critical styles after the HTML parser finishes. */
(() => {
    document.querySelectorAll('link[data-lazy-stylesheet]').forEach((link) => {
        const promote = () => { link.media = 'all'; };
        link.addEventListener('load', promote, { once: true });
        window.setTimeout(promote, 0);
    });
})();
