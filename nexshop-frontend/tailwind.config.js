/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: "class",
    content: ["./index.html", "./script.js"],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Plus Jakarta Sans', 'sans-serif'],
                serif: ['Plus Jakarta Sans', 'sans-serif'], 
            },
            colors: {
                brand: {
                    indigo: '#8B5CF6',
                    cyan: '#22D3EE',
                    dark: '#080B14',
                    light: '#F4F0FC',
                    muted: '#8891B0',
                }
            },
            backgroundImage: {
                'grain': 'url("https://www.transparenttextures.com/patterns/stardust.png")',
            },
            boxShadow: {
                'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
                'glass-light': '0 8px 32px 0 rgba(255, 255, 255, 0.1)',
            }
        },
    },
    plugins: [
        require('@tailwindcss/forms'),
        require('@tailwindcss/container-queries')
    ]
}
