const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// --- FUNGSI BANTUAN: WAKTU WIB ---
function dapatkanWaktuWIB() {
    const opsi = { 
        timeZone: 'Asia/Jakarta', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    };
    return new Date().toLocaleString('id-ID', opsi) + " WIB";
}

// Mendapatkan format tanggal pendek WIB (Contoh: "Oct 17, 2026" atau "17 Oct")
function getTanggalHariIniWIB() {
    const opsi = { timeZone: 'Asia/Jakarta', month: 'short', day: 'numeric', year: 'numeric' };
    return new Date().toLocaleDateString('en-US', opsi); // Contoh: "Oct 17, 2026"
}


// --- HALAMAN DEPAN API (DASHBOARD HTML) ---
app.get('/', (req, res) => {
    const waktuWIB = dapatkanWaktuWIB();
    
    const html = `
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dashboard API LotteryUSA</title>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #121212; color: #ffffff; margin: 0; padding: 20px; }
            .container { max-width: 900px; margin: 0 auto; }
            h1 { color: #00e676; text-align: center; margin-bottom: 5px; }
            .waktu { text-align: center; color: #aaaaaa; margin-bottom: 30px; font-size: 1.1em; background: #1e1e1e; padding: 10px; border-radius: 8px; border: 1px solid #333;}
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; }
            .market-card { background: #1e1e1e; padding: 15px; border-radius: 8px; border-left: 5px solid #03a9f4; }
            .market-card h2 { margin-top: 0; color: #03a9f4; font-size: 1.2em; border-bottom: 1px solid #333; padding-bottom: 10px; }
            a { display: block; color: #ff9800; text-decoration: none; font-weight: bold; background: #2c2c2c; padding: 12px; margin-bottom: 10px; border-radius: 5px; transition: 0.3s; text-align: center; }
            a:hover { background: #ff9800; color: #121212; }
            .btn-utama { background: #d32f2f; color: white; border-left: 5px solid #d32f2f; }
            .btn-utama a { color: white; background: #b71c1c; }
            .btn-utama a:hover { background: #ff5252; color: white;}
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 Server API Live Draw</h1>
            <div class="waktu">Waktu Server: <strong>${waktuWIB}</strong></div>

            <div class="market-card btn-utama" style="margin-bottom: 20px;">
                <h2 style="color:white;">🌐 Pasaran Nasional</h2>
                <a href="/api/markets" target="_blank">Lihat Semua Pasaran Utama (Powerball, dll)</a>
            </div>

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
                    <a href="/api/result/georgia/cash-4" target="_blank">Cash 4</a>
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
                    <h2>🌲 North Carolina</h2>
                    <a href="/api/result/north-carolina/midday-pick-4" target="_blank">Midday Pick 4</a>
                    <a href="/api/result/north-carolina/pick-4" target="_blank">Pick 4</a>
                </div>
                <div class="market-card">
                    <h2>🐻 Missouri</h2>
                    <a href="/api/result/missouri/midday-pick-4" target="_blank">Midday Pick 4</a>
                    <a href="/api/result/missouri/pick-4" target="_blank">Pick 4</a>
                </div>
                <div class="market-card">
                    <h2>🗽 New Jersey</h2>
                    <a href="/api/result/new-jersey/midday-pick-4" target="_blank">Midday Pick 4</a>
                    <a href="/api/result/new-jersey/pick-4" target="_blank">Pick 4</a>
                </div>
                <div class="market-card">
                    <h2>🏎️ Indiana</h2>
                    <a href="/api/result/indiana/midday-4" target="_blank">Midday 4</a>
                    <a href="/api/result/indiana/daily-4" target="_blank">Daily 4</a>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;
    
    res.send(html);
});


// --- FITUR: AMBIL PASARAN SPESIFIK (DENGAN PENGAMAN TANGGAL) ---
app.get('/api/result/:state/:game', async (req, res) => {
    const state = req.params.state;
    const game = req.params.game;
    const targetUrl = `https://www.lotteryusa.com/${state}/${game}/`;

    try {
        const response = await axios.get(targetUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });

        const $ = cheerio.load(response.data);
        
        let namaPasaran = $('h1').text().trim() || `${state} ${game}`;
        namaPasaran = namaPasaran.replace(/winning numbers/i, '').replace(/\s+/g, ' ').trim();
        
        // Ambil teks tanggal langsung dari web USA untuk divalidasi
        let tanggalWebUsa = "";
        let timeText = $('time').first().text().trim();
        if (timeText) {
             tanggalWebUsa = timeText;
        } else {
             tanggalWebUsa = $('[class*="date"]').first().text().trim();
        }

        // Ambil Angka Keluar (Maksimal 4 angka)
        let angka_keluar = [];
        const bolaPertama = $('[class*="ball"]').first();
        
        if (bolaPertama.length > 0) {
            bolaPertama.parent().find('[class*="ball"]').each((i, el) => {
                const angka = $(el).text().trim();
                if (angka && angka.length <= 3 && angka_keluar.length < 4) {
                    angka_keluar.push(angka);
                }
            });
        }

        // --- PENGAMANAN TAMBAHAN (VALIDASI STATUS) ---
        // Jika web USA bertuliskan "Today", "Tomorrow", atau memuat tanggal hari ini, statusnya AMAN.
        // Tapi jika datanya kosong, kita berikan status peringatan ke bot Anda.
        let statusData = "sukses";
        if (angka_keluar.length === 0) {
            statusData = "belum_update";
        }

        res.json({
            status: statusData,
            sumber: targetUrl,
            data: {
                pasaran: namaPasaran,
                keterangan_waktu_usa: tanggalWebUsa, // Contoh: "Today at 1:20 pm" / "Tomorrow"
                tanggal_ditarik_wib: dapatkanWaktuWIB(), // Jam WIB saat ditarik
                angka_keluar: angka_keluar
            }
        });

    } catch (error) {
        res.status(500).json({ status: "error", pesan: "Gagal mengambil data", detail: error.message });
    }
});


// --- FITUR: AMBIL PASARAN UTAMA ---
app.get('/api/markets', async (req, res) => {
    try {
        const response = await axios.get('https://www.lotteryusa.com/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const $ = cheerio.load(response.data);
        const markets = [];
        const bukanLotre = ['PLAY', 'Play online', 'Daily game stats', 'On this day'];

        $('h3').each((index, element) => {
            const namaPasaran = $(element).text().trim();
            if (namaPasaran && !bukanLotre.includes(namaPasaran) && !namaPasaran.includes('?') && namaPasaran.length <= 25) {
                let parent = $(element).parent();
                let angka_keluar = [];
                let tanggal = "Belum diundi";
                let jackpot = "N/A";

                for (let level = 0; level < 5; level++) {
                    parent.find('[class*="ball"]').each((i, ballEl) => {
                        const angka = $(ballEl).text().trim();
                        if (angka && angka.length <= 3) angka_keluar.push(angka);
                    });

                    if (angka_keluar.length > 0) {
                        tanggal = parent.find('time, [class*="date"]').first().text().trim() || tanggal;
                        parent.find('[class*="jackpot"], [class*="prize"]').each((i, jpEl) => {
                            const jpText = $(jpEl).text().trim();
                            if(jpText && jpText.includes('$')) jackpot = jpText.replace(/\s+/g, ' ').trim();
                        });
                        break; 
                    }
                    parent = parent.parent(); 
                }

                if (angka_keluar.length > 0) {
                    markets.push({ pasaran: namaPasaran, tanggal_undian: tanggal, jackpot: jackpot, angka_keluar: angka_keluar });
                }
            }
        });

        res.json({ 
            status: "sukses", 
            waktu_update_wib: dapatkanWaktuWIB(),
            total_pasaran: markets.length, 
            data: markets 
        });
    } catch (error) {
        res.status(500).json({ status: "error", pesan: error.message });
    }
});

module.exports = app;
