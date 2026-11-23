# Kas Kelas

Aplikasi pencatatan kas kelas dengan papan publik read-only dan panel bendahara. Backend menggunakan Node.js + Express, halaman dirender dengan EJS, data lokal dapat disimpan sebagai JSON, dan deployment menggunakan Neon PostgreSQL.

## Struktur proyek

```text
.
├── data/                 # Dibuat otomatis; berisi kas.json
├── public/
│   ├── admin.js          # Interaksi panel bendahara
│   ├── public.js         # Dashboard publik dan pencarian
│   └── styles.css        # Tampilan responsif mobile-first
├── src/
│   ├── admins.js         # Autentikasi dan akun bendahara
│   ├── payments.js       # Rekap pembayaran tiap periode
│   ├── postgres.js       # Schema Neon dan session store PostgreSQL
│   └── store.js          # Adapter penyimpanan dan data awal
├── views/
│   ├── admin.ejs         # Panel pengelolaan
│   ├── index.ejs         # Dashboard publik
│   └── login.ejs         # Form login bendahara
├── .env.example
├── api/
│   └── index.js          # Entry point serverless Vercel
├── vercel.json           # Rewrite Express dan aset view
├── package.json
└── server.js             # Aplikasi Express, autentikasi, dan API
```

## Jalankan di komputer

1. Pasang Node.js 18 atau lebih baru.
2. Dari folder proyek, jalankan `npm install`.
3. Salin `.env.example` menjadi `.env`. Untuk Neon, isi `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_USERNAME`, dan `ADMIN_PASSWORD`. Tanpa `DATABASE_URL`, data kas lokal memakai `data/kas.json` dan akun lokal pertama dibuat di `data/admins.json` (default `bendahara` / `kas12345`).
4. Jalankan `npm run dev` untuk pengembangan atau `npm start`.
5. Buka `http://localhost:3000`. Dashboard publik dapat dibaca tanpa login; panel bendahara ada di `http://localhost:3000/admin/login`.

Tanpa Neon, data dibuat di `data/kas.json`, akun lokal tersimpan sebagai hash di `data/admins.json`. Kedua file diabaikan Git.

Jalankan `npm test` untuk memeriksa perhitungan iuran, akses publik/admin, dan round-trip ekspor-impor Excel.

## Fitur dan akses

- Publik: ringkasan saldo, pemasukan/pengeluaran, status iuran mingguan, pencarian anggota, filter riwayat, dan wishlist beserta kecukupan saldo.
- Tabel pembayaran berisi NIM, nama, tanda lunas/belum, jumlah yang masuk, tanggal setoran, dan tunggakan. Siswa dapat melihat tabel serta memilih periode, tetapi tidak memiliki kontrol perubahan.
- Bendahara: login berbasis session, CRUD transaksi/anggota/wishlist, pengaturan iuran, tabel pembayaran yang dapat mencatat pembayaran per anggota, serta ekspor/impor Excel.
- Tab **Bendahara** hanya tersedia bagi akun yang sudah login. Bendahara dapat membuat akun bendahara lain; username harus unik, password minimal 10 karakter dan disimpan sebagai hash. Password akun yang sudah dibuat tidak bisa dilihat kembali.
- Ekspor berada pada tab **Pembayaran** di panel bendahara. File `.xlsx` berisi sheet `Pembayaran`; impor menerima file hasil ekspor dengan seluruh mahasiswa untuk satu periode. Edit `Nominal Bayar` dan `Tanggal Bayar`, lalu impor. Impor mengganti catatan pembayaran mahasiswa untuk periode dalam file agar bisa dijalankan ulang tanpa transaksi duplikat; transaksi umum dan periode lain tetap utuh.
- Endpoint perubahan data memerlukan sesi admin dan token CSRF; endpoint import/export Excel juga hanya tersedia untuk bendahara.
- API baca publik: `GET /api/public`. Semua API tulis berada di `/api/admin/*` dan dilindungi autentikasi.
- API tabel publik menerima `?period=YYYY-MM-DD`; tanggal akan dihitung ke awal minggu. Admin mengunduh `GET /api/admin/payments.xlsx?period=YYYY-MM-DD` dan mengimpor melalui `POST /api/admin/payments/import`.
- Neon menyimpan data kas di `kas_state` (JSONB), akun ter-hash di `admins`, dan session di `user_sessions`. Kredensial bootstrap dari environment hanya membuat akun pertama saat tabel admin masih kosong.
- Database kosong diisi roster awal berisi 40 mahasiswa dari daftar yang diberikan. Akun pertama Neon dibuat dari `ADMIN_NAME`, `ADMIN_USERNAME`, dan `ADMIN_PASSWORD` pada environment.

## Deploy ke Vercel

Vercel menjalankan Express sebagai function serverless; `DATABASE_URL` Neon wajib digunakan karena filesystem lokal dan session memory tidak persisten.

1. Push folder proyek ke repository GitHub.
2. Buat project/database di Neon, salin **pooled connection string** dari dashboard, dan gunakan sebagai `DATABASE_URL`.
3. Jalankan `npx vercel login`, kemudian `npx vercel` dari folder proyek dan ikuti proses linking ke akun Vercel. Untuk lokal tanpa Neon, biarkan `DATABASE_URL` kosong.
4. Di Vercel Project Settings → Environment Variables, tambahkan `NODE_ENV=production`, `DATABASE_URL`, `SESSION_SECRET` (acak dan panjang), `ADMIN_NAME`, `ADMIN_USERNAME`, dan `ADMIN_PASSWORD`. Jangan masukkan connection string/password ke repository.
5. Deploy dengan `npx vercel --prod`. Buka domain `.vercel.app` yang ditampilkan CLI; halaman admin berada di `/admin/login`.

`vercel.json` mengarahkan request ke function Express. Saat pertama terkoneksi ke database kosong, aplikasi membuat tabel dan mengisi roster awal serta akun bootstrap dari environment. Data lokal di `data/kas.json` tidak diimpor otomatis ke Neon. Sesi login tersimpan di PostgreSQL dan cookie memakai HttpOnly/SameSite/secure.

Untuk mencoba mode lokal tanpa Neon, jangan isi `DATABASE_URL`; jalankan `npm start` dan aplikasi menggunakan file JSON lokal.