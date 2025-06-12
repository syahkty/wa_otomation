const express = require('express');
const fs = require('fs');
const cors = require('cors'); // Untuk mengizinkan akses dari domain lain (penting!)

const app = express();
const port = 3100; // Anda bisa ganti port jika perlu

app.use(cors()); // Mengaktifkan CORS
app.use(express.json()); // Middleware untuk membaca body JSON dari request
app.use(express.static('public')); // Menyajikan file dari folder 'public' (untuk index.html)

const DB_FILE = './db.json';

// Fungsi untuk membaca database
const readDB = () => {
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(data);
};

// Fungsi untuk menulis ke database
const writeDB = (data) => {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
};

// ENDPOINT 1: Mendapatkan semua data hutang (untuk ditampilkan di web)
app.get('/api/hutang', (req, res) => {
    const db = readDB();
    // Mengubah format agar lebih mudah diolah di frontend
    const formattedHutang = Object.keys(db.hutang).map(nomor => ({
        nomor: nomor,
        totalHutang: db.hutang[nomor].totalHutang,
        transaksi: db.hutang[nomor].transaksi
    }));
    res.json(formattedHutang);
});

// ENDPOINT 2: Menambah hutang baru (untuk di-call oleh n8n)
app.post('/api/hutang', (req, res) => {
    const { nomor, jumlah, keterangan } = req.body;

    if (!nomor || !jumlah || !keterangan) {
        return res.status(400).json({ message: 'Data tidak lengkap: nomor, jumlah, dan keterangan diperlukan.' });
    }

    const db = readDB();
    const hutangUser = db.hutang[nomor] || { totalHutang: 0, transaksi: [] };

    hutangUser.totalHutang += jumlah;
    hutangUser.transaksi.push({
        jenis: 'hutang',
        jumlah: jumlah,
        keterangan: keterangan,
        tanggal: new Date().toISOString()
    });

    db.hutang[nomor] = hutangUser;
    writeDB(db);

    res.status(201).json({ message: 'Hutang berhasil ditambahkan', data: hutangUser });
});

// ENDPOINT 3: Melakukan pembayaran (untuk di-call oleh n8n)
app.post('/api/bayar', (req, res) => {
    const { nomor, jumlah } = req.body;

    if (!nomor || !jumlah) {
        return res.status(400).json({ message: 'Data tidak lengkap: nomor dan jumlah diperlukan.' });
    }

    const db = readDB();
    const hutangUser = db.hutang[nomor];

    if (!hutangUser) {
        return res.status(404).json({ message: 'Nomor tidak ditemukan di daftar hutang.' });
    }

    hutangUser.totalHutang -= jumlah;
    hutangUser.transaksi.push({
        jenis: 'bayar',
        jumlah: jumlah,
        keterangan: 'Pembayaran',
        tanggal: new Date().toISOString()
    });

    // Jika lunas, kita bisa hapus entri nya, atau biarkan saja dengan total 0
    // if (hutangUser.totalHutang <= 0) {
    //     delete db.hutang[nomor];
    // } else {
        db.hutang[nomor] = hutangUser;
    // }
    
    writeDB(db);
    res.status(200).json({ message: 'Pembayaran berhasil dicatat', data: hutangUser });
});


app.listen(port, () => {
    console.log(`Server API berjalan di http://localhost:${port}`);
});