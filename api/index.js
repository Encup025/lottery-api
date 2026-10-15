const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/', (req, res) => {
    res.json({ message: "API is running!" });
});

app.get('/api/markets', async (req, res) => {
    try {
        // Menggunakan header palsu agar terlihat lebih seperti browser asli
        const response = await axios.get('https://www.lotteryusa.com/', {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            }
        });

        const $ = cheerio.load(response.data);
        
        // MENDETEKSI APA YANG DILIHAT SERVER
        const pageTitle = $('title').text().trim();
        
        // Mencoba mengambil data dengan cara kasar (mencari semua class yang mungkin)
        const markets = [];
        $('.state-results, .result, .game, article, .draw-result').each((index, element) => {
            const name = $(element).find('h2, h3, .name, .title').first().text().trim();
            if (name) {
                markets.push({ nama_pasaran: name });
            }
        });

        res.json({
            status: "sukses",
            debug_info: {
                judul_halaman_yang_ditangkap: pageTitle,
                ukuran_data: response.data.length
            },
            total: markets.length,
            data: markets
        });

    } catch (error) {
        res.status(500).json({ status: "error", message: error.message });
    }
});

// Wajib untuk Vercel
module.exports = app;
