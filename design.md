# NexShop v1.2 Design System

Dokumen ini menjelaskan sistem desain dan aturan UI/UX yang digunakan pada antarmuka frontend NexShop v1.2.

## 1. Stack Teknologi Visual
- **Framework CSS**: Tailwind CSS v3 (dikompilasi lokal untuk mengamankan CSP).
- **Custom CSS**: `style.css` untuk keyframes animasi kompleks, utilitas kustom (seperti `glass-panel`), dan variabel warna fallback.
- **Font**: 
  - *Plus Jakarta Sans* (Google Fonts) untuk teks utama.
  - *Material Symbols Outlined* & *Font Awesome 6* untuk ikonografi.
- **Interaktivitas**: Vanilla JavaScript (tanpa framework seperti React/Vue).

## 2. Palet Warna (Color Palette)
NexShop menggunakan tema yang sangat kontras dengan dukungan fitur **Light Mode** dan **Dark Mode**.

### Brand Colors (Tailwind)
- **Brand Indigo**: `from-brand-indigo` / `text-brand-indigo` (Warna aksen ungu kebiruan).
- **Brand Cyan**: `to-brand-cyan` / `text-brand-cyan` (Warna aksen biru muda bercahaya).
- *Gradient perpaduan antara Indigo dan Cyan sering digunakan untuk teks utama (hero) dan border aksen.*

### Background Colors
- **Light Mode**: `bg-slate-50` (dominan putih/abu-abu sangat terang).
- **Dark Mode**: `dark:bg-[#131318]` (hitam kebiruan sangat gelap, memberi kesan elegan dan *gaming*).

## 3. Komponen Kunci

### Glassmorphism (`.glass-panel`)
Digunakan secara ekstensif pada Navbar, Modal, dan Kartu interaktif.
- **Efek**: Background semi-transparan dengan `backdrop-filter: blur(14px)`.
- **Tampilan Dark Mode**: `rgba(255, 255, 255, 0.03)` dengan border tipis `rgba(255, 255, 255, 0.05)`.
- **Tampilan Light Mode**: `rgba(255, 255, 255, 0.6)` dengan border `rgba(0, 0, 0, 0.05)`.

### Typography & Headings
- Menggunakan kelas Tailwind `tracking-tighter` untuk heading agar terlihat padat dan modern.
- Teks utama (Hero) sering menggunakan teks transparan bergradasi: 
  `text-transparent bg-clip-text bg-gradient-to-r from-brand-indigo to-brand-cyan`

### Tombol (Buttons)
- **Primary Buttons**: Menggunakan gradient brand atau `glass-panel` dengan efek hover transisi yang mulus.
- **Magnetic Buttons**: Utilitas `.btn-magnetic` membuat tombol membesar sedikit (`scale(1.05)`) dan terangkat (`translateY(-2px)`) saat di-hover.

## 4. Efek dan Animasi Kustom

- **Ambient Backgrounds**: Menggunakan div absolut dengan ukuran besar, *blur* tinggi (`blur-[120px]`), dan *blend mode* (`mix-blend-color-dodge`) untuk menciptakan cahaya ambient (biasanya Indigo di kiri atas dan Cyan di kanan bawah).
- **Film Grain**: `.bg-grain-overlay` memberikan tekstur *noise* tipis di seluruh halaman untuk kesan premium/cinematic.
- **Animasi CSS**:
  - `animate-float-slow`: Elemen melayang perlahan (biasanya untuk ikon hero atau aset grafis 3D).
  - `reveal-up`: Muncul perlahan dari bawah ke atas.
  - `loader-glow-pulse` & `loader-logo-pulse`: Animasi *loading screen*.

## 5. Aturan Responsivitas (Grid)
- Grid kartu produk sepenuhnya dikendalikan oleh Tailwind CSS classes.
- Contoh: `grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6`.
- *Catatan:* Hindari mencampur aturan kolom grid CSS kustom (seperti `grid-template-columns: repeat(...)`) ke dalam elemen yang sudah menggunakan kelas grid responsif Tailwind untuk mencegah konflik dan masalah *override*.

## 6. Aturan Aksesibilitas & CSP (Content Security Policy)
Mulai dari versi 1.2:
- Dilarang menggunakan inline event handlers (seperti `onclick`, `onerror`) pada markup HTML.
- Semua *event binding* dilakukan melalui JavaScript eksternal menggunakan `addEventListener`.
- Dilarang menempatkan styling inline yang bisa menimpa kelas kustom jika tidak benar-benar perlu (prioritaskan Tailwind utility classes).
