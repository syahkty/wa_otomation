// api/index.js  (ESM)
import express from 'express';
import cors from 'cors';
import { kv } from '@vercel/kv';

const app = express();
app.use(cors());
app.use(express.json());

// ===== Konfigurasi =====
const PAIR_KEY = 'pair:sakti-misba:v1';       // state utama
const DEDUP_PREFIX = 'pair:dedup:';           // kunci dedup message_id
const TX_LIMIT = 1000;                        // simpan max 1000 transaksi

// ===== Helper =====
async function getState() {
  return (await kv.get(PAIR_KEY)) || { balance: 0, tx: [] };
}
async function saveState(state) {
  await kv.set(PAIR_KEY, state);
}
function human(balance) {
  if (balance === 0) return 'Lunas';
  if (balance > 0)  return `Sakti berhutang Rp ${balance.toLocaleString('id-ID')}`;
  return `Misba berhutang Rp ${Math.abs(balance).toLocaleString('id-ID')} ke Sakti`;
}
function parseAmountFromText(text) {
  if (!text) return null;
  const m = text.match(/bayar\s+([0-9\.\,kK]+)/i);
  if (!m) return null;
  let s = m[1].toLowerCase();
  if (s.endsWith('k')) {
    const n = parseInt(s.replace(/[^\d]/g, ''), 10);
    return n ? n * 1000 : null;
  }
  const n = parseInt(s.replace(/[^\d]/g, ''), 10);
  return n || null;
}

// ===== Endpoint untuk n8n/WAHA =====
// Body contoh dari n8n:
// { sender: "sakti"|"misba", amount: 26000, text: "bayar 26000", message_id: "DAE46E..." }
app.post('/api/wa', async (req, res) => {
  try {
    const { sender, amount: amt, text, message_id } = req.body || {};

    if (!sender || !['sakti', 'misba'].includes(sender)) {
      return res.status(400).json({ ok: false, error: 'sender harus "sakti" atau "misba"' });
    }
    let amount = Number(amt) || parseAmountFromText(text);
    if (!amount || amount <= 0) {
      return res.status(400).json({ ok: false, error: 'amount tidak valid' });
    }

    // Idempoten (hindari dobel jika WAHA retry)
    if (message_id) {
      // NX=true: hanya set jika belum ada; EX=30 hari
      const ok = await kv.set(`${DEDUP_PREFIX}${message_id}`, 1, { nx: true, ex: 60 * 60 * 24 * 30 });
      if (ok === null) {
        const s = await getState();
        return res.status(200).json({ ok: true, duplicate: true, balance: s.balance, human: human(s.balance) });
      }
    }

    const state = await getState();

    // Logika dua orang:
    // - Pesan dari MISBA = menambah hutang SAKTI (misba membayarkan sesuatu untuk Sakti)
    // - Pesan dari SAKTI = mengurangi hutang SAKTI (Sakti membayar)
    const txType = sender === 'misba' ? 'hutang' : 'bayar';
    const note   = sender === 'misba' ? 'Misba membayarkan untuk Sakti' : 'Sakti membayar';

    let balance = state.balance || 0;
    if (sender === 'misba') balance += amount; else balance -= amount;

    const entry = {
      id: message_id || `tx_${Date.now()}`,
      ts: new Date().toISOString(),
      sender,             // 'sakti' | 'misba'
      type: txType,       // 'hutang' | 'bayar'
      amount,             // integer rupiah
      note
    };

    const tx = Array.isArray(state.tx) ? state.tx : [];
    tx.push(entry);
    if (tx.length > TX_LIMIT) tx.splice(0, tx.length - TX_LIMIT);

    await saveState({ balance, tx });

    return res.status(200).json({ ok: true, balance, human: human(balance) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ===== Ringkasan status (untuk debugging/otomasi) =====
app.get('/api/status', async (req, res) => {
  const s = await getState();
  return res.status(200).json({
    balance: s.balance || 0,
    human: human(s.balance || 0),
    owes: s.balance > 0 ? 'sakti' : (s.balance < 0 ? 'misba' : 'lunas'),
    transactions: (s.tx || []).slice(-100).reverse()
  });
});

// ===== Kompatibel dengan HTML lama kamu (GET /api/hutang) =====
// Menghasilkan array berisi 0/1 item sesuai siapa yang sedang berhutang.
// HTML kamu sudah mengurutkan & hanya menampilkan jika totalHutang > 0.
app.get('/api/hutang', async (req, res) => {
  const s = await getState();
  const bal = s.balance || 0;
  const tx = (s.tx || []).map(t => ({
    jenis: t.type,             // 'hutang'|'bayar'
    jumlah: t.amount,
    keterangan: t.note,
    tanggal: t.ts
  }));

  if (bal === 0) return res.status(200).json([]);
  if (bal > 0) {
    // Sakti sedang berhutang
    return res.status(200).json([{ nomor: 'sakti', totalHutang: bal, transaksi: tx }]);
  } else {
    // Misba sedang berhutang (saldo negatif → balikkan namanya)
    return res.status(200).json([{ nomor: 'misba', totalHutang: Math.abs(bal), transaksi: tx }]);
  }
});

// Penting di Vercel: jangan app.listen, cukup export default
export default app;
