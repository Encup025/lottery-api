const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// --- FUNGSI: TANGGAL WIB FORMAT INDONESIA (Sesuai Gambar) ---
function getTanggalWIB() {
    const hari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const bulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    
    // Ambil waktu saat ini di zona WIB
    const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"}));
    
    const namaHari = hari[now.getDay()];
    const tanggal = now.getDate();
    const namaBulan = bulan[now.getMonth()];
    const tahun = now.getFullYear();
    
    // Hasil: "Sabtu, 17 Oktober 2026"
    return `${namaHari}, ${tanggal} ${namaBulan} ${tahun}`;
}

// --- HALAMAN DEPAN API (DASHBOARD HTML) ---
app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dashboard API Live Draw USA</title>
        <style>
            body { font-family: 'Segoe UI', Tahoma, sans-serif; background-color: #121212; color: #ffffff; margin: 0; padding: 20px; }
            .container { max-width: 900px; margin: 0 auto; }
            h1 { color: #00e676; text-align: center; margin-bottom: 30px; }
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; }
            .market-card { background: #1e1e1e; padding: 15px; border-radius: 8px; border-left: 5px solid #03a9f4; }
            .market-card h2 { margin-top: 0; color: #03a9f4; font-size: 1.2em; border-bottom: 1px solid #333; padding-bottom: 10px; }
            a { display: block; color: #ff9800; text-decoration: none; font-weight: bold; background: #2c2c2c; padding: 12px; margin-bottom: 10px; border-radius: 5px; transition: 0.3s; text-align: center; }
            a:hover { background: #ff9800; color: #121212; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 Server API Live Draw USA (Clean)</h1>
            <div class="grid">
                <div class="market-card">
                    <h2>🍗 Kentucky</h2>
                    <a href="/api/result/kentucky/midday-pick-4" target="_blank">Midday Pick 4</a>
                    <a href="/api/result/kentucky/pick-4" target="_blank">Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🍑 Georgia</h2>
                    <a href="/api/result/georgia/midday-4" target="_blank">Midday 4</a>
                    <a href="/api/result/georgia/cash-4-evening" target="_blank">Cash 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🦅 Virginia</h2>
                    <a href="/api/result/virginia/midday-4" target="_blank">Midday 4</a>
                    <a href="/api/result/virginia/pick-4" target="_blank">Pick 4</a>
                </div>
                <div class="market-card">
                    <h2>⭐ Texas</h2>
                    <a href="/api/result/texas/morning-pick-4" target="_blank">Morning Pick 4</a>
                </div>
                <div class="market-card">
                    <h2>🐻 Missouri</h2>
                    <a href="/api/result/missouri/midday-pick-4" target="_blank">Midday Pick 4</a>
                    <a href="/api/result/missouri/pick-4" target="_blank">Pick 4</a>
                </div>
                <div class="market-card">
                    <h2>🗽 New Jersey & Indiana</h2>
                    <a href="/api/result/new-jersey/pick-4" target="_blank">NJ Pick 4</a>
                    <a href="/api/result/indiana/daily-4" target="_blank">IN Daily 4</a>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

// --- FITUR: AMBIL RESULT (SANGAT CLEAN & ANTI-BASI) ---
app.get('/api/result/:state/:game', async (req, res) => {
    const state = req.params.state;
    const game = req.params.game;
    const targetUrl = `https://www.lotteryusa.com/${state}/${game}/`;

    try {
        const response = await axios.get(targetUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });

        const $ = cheerio.load(response.data);
        
        // Ambil Nama Pasaran
        let namaPasaran = $('h1').text().trim() || `${state} ${game}`;
        namaPasaran = namaPasaran.replace(/winning numbers/i, '').replace(/\s+/g, ' ').trim();
        
        // Ambil Teks Tanggal Web USA untuk deteksi basi (Yesterday/Kemarin)
        let timeText = $('time').first().text().trim().toLowerCase();
        if (!timeText) {
             timeText = $('[class*="date"]').first().text().trim().toLowerCase();
        }

        // Ambil Angka
        let angka_keluar = [];
        const containerBola = $('[class*="ball"]').first();
        if (containerBola.length > 0) {
            containerBola.parent().find('[class*="ball"]').each((i, el) => {
                const angka = $(el).text().trim();
                if (angka && angka.length <= 2 && angka_keluar.length < 4) {
                    angka_keluar.push(angka);
                }
            });
        }

        // --- FILTER KETAT ANTI-BASI & BELUM RESULT ---
        const pageText = $('body').text().toLowerCase();
        
        const isBasiAtauBelumResult = 
            angka_keluar.length === 0 || 
            angka_keluar.includes('--') ||
            pageText.includes('upcoming') || 
            pageText.includes('pending') || 
            timeText.includes('yesterday'); // Jika web USA masih mencantumkan tanggal "Yesterday", tolak datanya.

        if (isBasiAtauBelumResult) {
            return res.json({
                status: "belum_update",
                pesan: "Data masih basi atau belum result."
            });
        }

        // --- JIKA DATA FRESH & BERHASIL ---
        // Format angka digabung, misal ["3", "2", "5", "9"] jadi "3259"
        const resultAngka = angka_keluar.join(""); 

        res.json({
            status: "sukses",
            pasaran: namaPasaran.toUpperCase(),
            tanggal_wib: getTanggalWIB(),
            angka_keluar: resultAngka
        });

    } catch (error) {
        res.status(500).json({ status: "error", pesan: "Gagal memproses", detail: error.message });
    }
});

module.exports = app;
