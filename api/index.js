const express = require('express');
const cors = require('cors');
const { kv } = require('@vercel/kv'); // Import Vercel KV

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Kunci utama untuk menyimpan data di Vercel KV
const DB_KEY = 'proyek-hutang';

// --- ENDPOINT UNTUK MENDAPATKAN SEMUA HUTANG ---
app.get('/api/hutang', async (req, res) => {
  try {
    const db = await kv.get(DB_KEY) || { hutang: {} };
    const formattedHutang = Object.keys(db.hutang).map(nomor => ({
      nomor: nomor,
      totalHutang: db.hutang[nomor].totalHutang,
      transaksi: db.hutang[nomor].transaksi
    }));
    res.status(200).json(formattedHutang);
  } catch (error) {
    res.status(500).json({ message: 'Gagal mengambil data', error: error.message });
  }
});

// --- ENDPOINT UNTUK MENAMBAH HUTANG BARU ---
app.post('/api/hutang', async (req, res) => {
  try {
    const { nomor, jumlah, keterangan } = req.body;
    if (!nomor || !jumlah || !keterangan) {
      return res.status(400).json({ message: 'Data tidak lengkap.' });
    }

    const db = await kv.get(DB_KEY) || { hutang: {} };
    const hutangUser = db.hutang[nomor] || { totalHutang: 0, transaksi: [] };

    hutangUser.totalHutang += jumlah;
    hutangUser.transaksi.push({
      jenis: 'hutang',
      jumlah: jumlah,
      keterangan: keterangan,
      tanggal: new Date().toISOString()
    });

    db.hutang[nomor] = hutangUser;
    await kv.set(DB_KEY, db); // Simpan kembali ke Vercel KV

    res.status(201).json({ message: 'Hutang berhasil ditambahkan' });
  } catch (error) {
    res.status(500).json({ message: 'Gagal menambah hutang', error: error.message });
  }
});

// --- ENDPOINT UNTUK MELAKUKAN PEMBAYARAN ---
app.post('/api/bayar', async (req, res) => {
  try {
    const { nomor, jumlah } = req.body;
    if (!nomor || !jumlah) {
      return res.status(400).json({ message: 'Data tidak lengkap.' });
    }

    const db = await kv.get(DB_KEY) || { hutang: {} };
    const hutangUser = db.hutang[nomor];
    if (!hutangUser) {
      return res.status(404).json({ message: 'Nomor tidak ditemukan.' });
    }

    hutangUser.totalHutang -= jumlah;
    hutangUser.transaksi.push({
      jenis: 'bayar',
      jumlah: jumlah,
      keterangan: 'Pembayaran',
      tanggal: new Date().toISOString()
    });

    db.hutang[nomor] = hutangUser;
    await kv.set(DB_KEY, db); // Simpan kembali ke Vercel KV

    res.status(200).json({ message: 'Pembayaran berhasil dicatat' });
  } catch (error) {
    res.status(500).json({ message: 'Gagal mencatat pembayaran', error: error.message });
  }
});

// PENTING: Jangan gunakan app.listen(). Cukup ekspor app.
module.exports = app;