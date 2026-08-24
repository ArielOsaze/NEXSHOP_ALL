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
                    indigo: '#0891B2',
                    cyan: '#22D3EE',
                    electric: '#00C2E8',
                    dark: '#090B0F',
                    light: '#F8FAFC',
                    muted: '#98A2B3',
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
