const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// --- FUNGSI BANTUAN 1: WAKTU WIB ---
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

// --- FUNGSI BANTUAN 2: TANGGAL WIB UNTUK OUTPUT BOT (INDEPENDEN) ---
function getTanggalWIB() {
    const hari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const bulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    
    // Mengambil tanggal real-time saat ini di zona waktu Indonesia (WIB)
    const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"}));
    return `${hari[now.getDay()]}, ${now.getDate()} ${bulan[now.getMonth()]} ${now.getFullYear()}`;
}

// --- FUNGSI BANTUAN 3: SCRAPER PROXY GRATIS OTOMATIS (FALLBACK) ---
async function getFreeProxies() {
    try {
        const response = await axios.get('https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt', { timeout: 4000 });
        return response.data.split('\n').map(p => p.trim()).filter(p => p.includes(':')).slice(0, 10);
    } catch (e) {
        return ['103.152.112.162:80', '47.74.152.29:8888', '118.174.204.142:8080'];
    }
}

// --- FUNGSI PENGAMBIL DATA (ANTI-BLOCK DENGAN PROXY) ---
async function fetchWithAntiBlock(targetUrl) {
    const headersConfig = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Upgrade-Insecure-Requests': '1'
    };

    try {
        const response = await axios.get(targetUrl, { headers: headersConfig, timeout: 8000 });
        if (response.status === 200) return response.data;
    } catch (err1) {
        console.log("Direct request blocked, trying proxy...");
    }

    const proxies = await getFreeProxies();
    for (let proxy of proxies) {
        try {
            const proxyTargetUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
            const response = await axios.get(proxyTargetUrl, { timeout: 6000 });
            if (response.status === 200 && response.data) return response.data;
        } catch (errProxy) { 
            continue; 
        }
    }
    throw new Error("Semua jalur akses ditolak oleh target.");
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
        <title>Dashboard API Live Draw USA</title>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #121212; color: #ffffff; margin: 0; padding: 20px; }
            .container { max-width: 1000px; margin: 0 auto; }
            h1 { color: #00e676; text-align: center; margin-bottom: 5px; }
            .waktu { text-align: center; color: #aaaaaa; margin-bottom: 30px; font-size: 1.1em; background: #1e1e1e; padding: 10px; border-radius: 8px; border: 1px solid #333;}
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; }
            .market-card { background: #1e1e1e; padding: 15px; border-radius: 8px; border-left: 5px solid #03a9f4; }
            .market-card h2 { margin-top: 0; color: #03a9f4; font-size: 1.2em; border-bottom: 1px solid #333; padding-bottom: 10px; }
            a { display: block; color: #ff9800; text-decoration: none; font-weight: bold; background: #2c2c2c; padding: 12px; margin-bottom: 10px; border-radius: 5px; text-align: center; transition: 0.3s;}
            a:hover { background: #ff9800; color: #121212; }
            .btn-utama { background: #d32f2f; border-left: 5px solid #d32f2f; }
            .btn-utama a { color: white; background: #b71c1c; }
            .btn-utama a:hover { background: #ff5252; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 Server API Live Draw USA</h1>
            <div class="waktu">Waktu Server: <strong>${waktuWIB}</strong></div>
            <div class="market-card btn-utama" style="margin-bottom: 20px;">
                <h2 style="color:white;">🌐 Pasaran Nasional</h2>
                <a href="/api/markets" target="_blank">Lihat Semua Pasaran Utama (Powerball, dll)</a>
            </div>
            <div class="grid">
                <div class="market-card">
                    <h2>⭐ Texas</h2>
                    <a href="/api/result/texas/morning-daily-4" target="_blank">Morning Daily 4</a>
                    <a href="/api/result/texas/day-daily-4" target="_blank">Day Daily 4</a>
                    <a href="/api/result/texas/evening-daily-4" target="_blank">Evening Daily 4</a>
                    <a href="/api/result/texas/night-daily-4" target="_blank">Night Daily 4</a>
                </div>
                <div class="market-card">
                    <h2>🌲 Oregon</h2>
                    <a href="/api/result/oregon/1-pm-pick-4" target="_blank">Oregon 3 (1 PM)</a>
                    <a href="/api/result/oregon/4-pm-pick-4" target="_blank">Oregon 6 (4 PM)</a>
                    <a href="/api/result/oregon/7-pm-pick-4" target="_blank">Oregon 9 (7 PM)</a>
                    <a href="/api/result/oregon/10-pm-pick-4" target="_blank">Oregon 12 (10 PM)</a>
                </div>
                <div class="market-card">
                    <h2>🍗 Kentucky</h2>
                    <a href="/api/result/kentucky/midday-pick-4" target="_blank">Midday Pick 4</a>
                    <a href="/api/result/kentucky/pick-4" target="_blank">Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🍊 Florida</h2>
                    <a href="/api/result/florida/pick-4-midday" target="_blank">Midday Pick 4</a>
                    <a href="/api/result/florida/pick-4-evening" target="_blank">Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🗽 New York</h2>
                    <a href="/api/result/new-york/midday-win-4" target="_blank">Midday Win 4</a>
                    <a href="/api/result/new-york/win-4" target="_blank">Win 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🏛️ Washington DC</h2>
                    <a href="/api/result/washington-dc/dc-4-midday" target="_blank">DC-4 Midday</a>
                    <a href="/api/result/washington-dc/dc-4" target="_blank">DC-4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🌲 North Carolina</h2>
                    <a href="/api/result/north-carolina/midday-pick-4" target="_blank">Midday Pick 4</a>
                    <a href="/api/result/north-carolina/pick-4" target="_blank">Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🦅 Virginia</h2>
                    <a href="/api/result/virginia/midday-4" target="_blank">Midday 4</a>
                    <a href="/api/result/virginia/pick-4" target="_blank">Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🍑 Georgia</h2>
                    <a href="/api/result/georgia/midday-4" target="_blank">Midday 4</a>
                    <a href="/api/result/georgia/cash-4-evening" target="_blank">Cash 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🐻 Missouri</h2>
                    <a href="/api/result/missouri/midday-pick-4" target="_blank">Midday Pick 4</a>
                    <a href="/api/result/missouri/pick-4" target="_blank">Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🏎️ Indiana & NJ</h2>
                    <a href="/api/result/indiana/midday-4" target="_blank">IN Midday 4</a>
                    <a href="/api/result/indiana/daily-4" target="_blank">IN Daily 4</a>
                    <a href="/api/result/new-jersey/midday-pick-4" target="_blank">NJ Midday Pick 4</a>
                    <a href="/api/result/new-jersey/pick-4" target="_blank">NJ Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🏖️ California</h2>
                    <a href="/api/result/california/daily-4" target="_blank">Daily 4</a>
                </div>
                <div class="market-card">
                    <h2>🌵 Arizona</h2>
                    <a href="/api/result/arizona/pick-4-midday" target="_blank">Midday Pick 4</a>
                    <a href="/api/result/arizona/pick-4" target="_blank">Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🌽 Iowa</h2>
                    <a href="/api/result/iowa/midday-4" target="_blank">Midday 4</a>
                    <a href="/api/result/iowa/pick-4" target="_blank">Pick 4 Evening</a>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});


// --- ENDPOINT SPESIFIK (DENGAN DETEKTOR REGEX TANGGAL USA & PENCARIAN TEPAT SASARAN) ---
app.get('/api/result/:state/:game', async (req, res) => {
    const state = req.params.state;
    const game = req.params.game;
    const targetUrl = `https://www.lotteryusa.com/${state}/${game}/`;

    try {
        const htmlData = await fetchWithAntiBlock(targetUrl);
        const $ = cheerio.load(htmlData);
        
        let namaPasaran = $('h1').text().trim() || `${state} ${game}`;
        namaPasaran = namaPasaran.replace(/winning numbers/i, '').replace(/\s+/g, ' ').trim().toUpperCase();
        
        const blokResultTeratas = $('.c-game-components').first().length > 0 ? $('.c-game-components').first() :$('main').first();

        let tanggalWebUsa = "";
        let angka_keluar = [];
        
        // 1. CARI BOLA ANGKA TERLEBIH DAHULU
        const bolaPertama = blokResultTeratas.find('[class*="ball"]').first();
        
        if (bolaPertama.length > 0) {
            // 2. MUNDUR KE BARIS (PARENT) TEMPAT BOLA ITU BERADA UNTUK MENCARI TANGGAL YANG BENAR (MENGABAIKAN TULISAN "NEXT DRAW")
            let parentBaris = bolaPertama.parent().parent();
            tanggalWebUsa = parentBaris.find('time').first().text().trim();
            if (!tanggalWebUsa) tanggalWebUsa = parentBaris.find('[class*="date"]').first().text().trim();
            if (!tanggalWebUsa) tanggalWebUsa = parentBaris.text().trim(); // Fallback ambil semua teks di baris bola tsb
            
            // 3. AMBIL ANGKA DARI BOLA
            bolaPertama.parent().find('[class*="ball"]').each((i, el) => {
                const angka = $(el).text().trim();
                if (angka && angka !== '--' && !isNaN(angka) && angka_keluar.length < 4) {
                    angka_keluar.push(angka);
                }
            });
        }
        
        tanggalWebUsa = tanggalWebUsa.toLowerCase();

        // 4. JIKA BOLA MASIH KOSONG / STRIP
        if (angka_keluar.length === 0) {
            return res.status(400).send("Angka belum tersedia (--).");
        }

        // 5. TENTUKAN ZONA WAKTU USA BERDASARKAN NEGARA BAGIAN
        let tz = 'America/New_York';
        if (['texas', 'missouri', 'iowa', 'indiana'].includes(state)) tz = 'America/Chicago';
        if (['california', 'oregon'].includes(state)) tz = 'America/Los_Angeles';
        if (state === 'arizona') tz = 'America/Phoenix';

        // 6. AMBIL BULAN DAN TANGGAL ASLI AMERIKA SAAT INI (REAL-TIME)
        const usDateObj = new Date(new Date().toLocaleString("en-US", {timeZone: tz}));
        const usDay = usDateObj.getDate().toString();
        const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
        const usMonth = monthNames[usDateObj.getMonth()]; 

        // 7. DETEKTOR TANGGAL REGEX (Hanya mengekstrak dari teks di sebelah bola)
        const regex = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[^0-9]*(\d+)/i;
        const match = tanggalWebUsa.match(regex);

        let webMonth = "";
        let webDay = "";

        if (match) {
            webMonth = match[1].toLowerCase();
            webDay = match[2];
        }

        // 8. PENGAMAN UTAMA: Cek kecocokan tanggal bola vs tanggal Amerika saat ini
        if (webMonth !== usMonth || webDay !== usDay) {
            return res.status(400).send(`Data belum update. Angka di web adalah untuk ${webMonth} ${webDay}, sedangkan hari ini di zona ${tz} adalah ${usMonth} ${usDay}.`);
        }

        // 9. JIKA SEMUA LOLOS: KELUARKAN JSON SUKSES BERSIH
        res.json({
            status: "sukses",
            pasaran: namaPasaran,
            tanggal_wib: getTanggalWIB(),
            angka_keluar: angka_keluar.join("")
        });

    } catch (error) {
        res.status(500).json({ status: "error", pesan: "Gagal mengambil data dari target", detail: error.message });
    }
});


// --- ENDPOINT: AMBIL PASARAN UTAMA ---
app.get('/api/markets', async (req, res) => {
    try {
        const htmlData = await fetchWithAntiBlock('https://www.lotteryusa.com/');
        const $ = cheerio.load(htmlData);
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
                if (angka_keluar.length > 0) markets.push({ pasaran: namaPasaran, tanggal_undian: tanggal, jackpot: jackpot, angka_keluar: angka_keluar });
            }
        });

        res.json({ status: "sukses", waktu_update_wib: dapatkanWaktuWIB(), total_pasaran: markets.length, data: markets });
    } catch (error) {
        res.status(500).json({ status: "error", pesan: error.message });
    }
});

module.exports = app;
