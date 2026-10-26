# EdGEO — Blueprint produk dan MVP

**Tanggal:** 26 Oktober 2026

**Tujuan:** MCP gratis, mandiri, dan local-first untuk membantu pemilik produk digital mengaudit SEO, GEO, serta visibilitas Google AI Search dari agent yang mendukung MCP.

## Arah produk

EdGEO adalah proyek mandiri. Ia tidak bergantung pada platform analitik, SaaS, vendor model, atau layanan EdGEO yang di-host. Audit teknis halaman berjalan di mesin pengguna. Pengukuran model eksternal dan impor data Search Console hanya memakai data atau kredensial yang diberikan dan disetujui pengguna.

MCP menyediakan tools dan prompt yang dapat dipakai lintas host. Bentuk pemanggilan `/edgeo` tetap mengikuti fitur masing-masing host; karena itu paket EdGEO menyertakan template command dan skill per host.

Hasil harus dapat diperiksa ulang: URL atau pertanyaan, kondisi pengukuran, waktu, bukti, aturan yang menghasilkan temuan, ketidakpastian, dan langkah validasi. Jangan menyatukan hasil menjadi skor tunggal tanpa menjelaskan definisi dan penyebutnya.

## Prinsip metodologi

- Pisahkan mention, deskripsi positif, rekomendasi eksplisit, sitasi, klik, dan kunjungan.
- Jawaban provider API bukan representasi otomatis dari pengalaman pengguna di aplikasi konsumen.
- Satu jawaban adalah satu observasi dalam kondisi tertentu, bukan peringkat permanen atau bukti tren.
- Catat kegagalan, jawaban parsial, dan data kosong secara terpisah. Request gagal bukan hasil “brand tidak muncul”.
- Simpan prompt, provider/model, permukaan produk, locale, mode pencarian, waktu, versi metode, dan sumber jawaban agar perbandingan dapat ditelusuri.
- Retry adalah attempt tambahan dan bukan sampel independen.
- Setiap rate menunjukkan jumlah kejadian dan penyebutnya. Jangan mengubah data kecil atau tidak lengkap menjadi kesimpulan pasti.

## Cakupan produk

EdGEO dirancang untuk situs SaaS dan produk digital, toko online, layanan profesional, dokumentasi, serta proyek digital lainnya. Pengguna sasaran meliputi pemilik produk, developer, marketer, konsultan, dan agensi.

### SEO

Audit teknis mengamati status HTTP, redirect, metadata, canonical, robots, headings, bahasa, viewport, link, alt text, Open Graph, Twitter Card, hreflang, dan tipe JSON-LD yang dapat dibaca dari HTML server. Crawl terbatas mengikuti link satu hostname, memeriksa sitemap, menerapkan robots.txt, dan memberi jeda antar-request. Temuan menjelaskan fakta yang teramati dan rekomendasi validasi.

Audit HTML tidak membuktikan indexing, posisi pencarian, rendering JavaScript, Core Web Vitals, ataupun kelayakan fitur hasil pencarian. Crawl terbatas bukan pemeriksaan seluruh situs; bila robots.txt tidak dapat dibaca, crawl dihentikan.

### GEO

Alur awal menganalisis jawaban AI yang disediakan pengguna. Tes perlu memisahkan pengenalan merek, penemuan tanpa merek, perbandingan, dan use case. Untuk setiap observasi, catat sumber, provider/model, antarmuka, prompt, locale, mode pencarian, waktu, status, jawaban, dan sitasi.

Mention nama yang terdeteksi otomatis masih perlu pemeriksaan entitas. Sitasi tidak membuktikan bahwa sumber mendukung klaim terkait. Rekomendasi tidak boleh disimpulkan dari mention semata.

Konektor model yang tersedia mencakup Ollama pada loopback dan Gemini API dengan persetujuan eksplisit. Pengguna harus mengetahui kapan prompt keluar ke provider dan menanggung biaya provider yang dipilih jika ada.

### Google AI Search dan SGE

“SGE” adalah istilah lama untuk eksperimen Search Generative Experience. Laporan dan antarmuka EdGEO menggunakan nama AI Overviews dan AI Mode, sambil tetap mengenali SGE sebagai kata pencarian lama.

Optimasi untuk fitur generatif Google tetap bergantung pada SEO dan persyaratan teknis Search. `llms.txt`, pemotongan halaman khusus untuk AI, maupun schema khusus GEO bukan persyaratan Google untuk fitur tersebut. Gunakan data Search Console milik pengguna atau observasi manual yang mencatat locale, akun, waktu, dan tangkapan layar. Jangan menyamakan data model API dengan hasil Google.

## Antarmuka agent

- MCP lokal memakai stdio agar tool berjalan pada mesin pengguna.
- Prompt MCP `edgeo` memberikan alur kerja umum.
- Skill dan custom command memberikan pengalaman panggilan khusus host, seperti `/edgeo` jika host mendukungnya.
- Host yang tidak mendukung custom slash command tetap dapat memakai tools melalui percakapan biasa.
- Installer lintas host dapat ditambahkan setelah format konfigurasi tiap host ditetapkan dan diverifikasi.

Contoh permintaan:

~~~text
/edgeo https://contoh.id
/edgeo audit halaman harga https://contoh.id/pricing
/edgeo tinjau jawaban model untuk merek Contoh di Indonesia
/edgeo ringkas data Search Console yang saya berikan
~~~

## Rancangan tool

| Tool | Status | Fungsi |
|---|---|---|
| `edgeo_audit_page` | Implementasi draft | Audit satu URL publik dari HTML dan header, termasuk metadata sosial dan tipe JSON-LD |
| `edgeo_crawl_site` | Implementasi draft | Crawl terbatas satu host, seed sitemap, robots.txt, jeda request, dan ringkasan temuan |
| `edgeo_analyze_visibility` | Implementasi draft | Analisis jawaban yang diberikan pengguna; pisahkan sumber, prompt, status, mention, dan sitasi |
| `edgeo_compare_visibility_runs` | Implementasi draft | Pasangkan prompt identik dan kondisi pengukuran yang sama; laporkan sampel tidak cocok |
| `edgeo_summarize_search_console` | Implementasi draft | Ringkas baris Search Console berdasarkan label fitur yang tersedia tanpa menebak |
| `edgeo_import_search_console_csv` | Implementasi draft | Parse CSV/TSV lokal, deteksi header Inggris/Indonesia, mapping eksplisit, dan ringkasan |

Pencarian AI melalui API model bersifat opsional dan bukan pengganti pengujian UI Google atau aplikasi konsumen. Jika kelak ditambahkan, tandai provider, model, surface, search mode, locale, dan waktu pada setiap hasil.

## Format temuan dan pelaporan

Setiap observasi sebaiknya mencatat:

~~~text
run_id, observed_at, target_domain, page_or_question,
source_type, provider, model, surface, locale, search_mode,
method_version, status, raw_evidence_reference,
finding, evidence_excerpt, confidence, limitation
~~~

Setiap saran berisi:

1. Temuan yang diamati.
2. Bukti dan kondisi yang mendasari temuan.
3. Dampak yang mungkin, sebagai hipotesis jika belum teruji.
4. Perubahan yang dapat dicoba.
5. Cara dan waktu validasi ulang.
6. Tingkat keyakinan serta batas metode.

## Privasi dan keamanan

URL publik dapat dipakai untuk SSRF jika validator lemah. Fetcher harus menerima HTTP/HTTPS saja, memblokir IP lokal/private/link-local dan layanan metadata, memvalidasi DNS dan tiap redirect, mengikat koneksi ke alamat yang tervalidasi, serta membatasi port, waktu, jumlah redirect, ukuran respons, dan concurrency. Jangan mengirim cookie atau kredensial ke situs target. Crawl masa depan harus tetap dalam host yang disetujui, menghormati robots.txt, dan menggunakan user-agent yang jelas.

HTML dan jawaban model adalah data tidak tepercaya. Instruksi yang ditemukan di halaman tidak boleh mengubah tujuan atau akses agent. Jangan mencatat secret di log. Jangan mengirim prompt atau fakta bisnis privat ke provider eksternal tanpa persetujuan pengguna.

## Status implementasi

Folder proyek berisi server MCP stdio, sembilan tool, prompt `edgeo`, installer untuk Claude Code, Codex, Cursor, dan Gemini CLI, konektor Ollama/Gemini, serta akses OAuth read-only ke Search Console. Installer membuat cadangan JSON sebelum menggabungkan konfigurasi host. Token Search Console disimpan pada komputer pengguna.

Build, typecheck, uji parser/analisis, request OAuth/API dengan mock, blokir SSRF loopback, installer Cursor/Gemini, dan MCP initialization/tool discovery telah diverifikasi otomatis. Renderer JavaScript, pengukuran Core Web Vitals, penyimpanan riwayat run, dan laporan file belum tersedia. Integrasi agent-host nyata, crawl produksi, OAuth pengguna, dan panggilan model langsung masih perlu diuji setelah release. Lisensi proyek Apache-2.0.

## Tahapan berikutnya

1. Validasi instalasi manual pada versi terbaru tiap host dan dokumentasikan matriks kompatibilitas.
2. Tambahkan penyimpanan riwayat lokal dan laporan ekspor setelah kebijakan retensi dan penghapusan dirancang.
3. Tambahkan renderer/field lab tests sebagai modul terpisah jika dibutuhkan, tanpa menyamakan hasil API dengan pengalaman konsumen.
4. Setelah repo publik, kirim metadata ke MCP Registry dan ajukan listing native per platform. Listing publik ChatGPT/Codex memerlukan endpoint HTTPS jika menggunakan remote MCP.
5. Pantau pembaruan Google OAuth, quota, Search Console dimensions, dan perilaku model; minta persetujuan sebelum setiap pengiriman prompt eksternal.

## Referensi teknis umum

- [Google Search: AI features and your website](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [Google Search Console: generative AI performance reports](https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports)
- [Model Context Protocol](https://modelcontextprotocol.io/introduction)
- [Cursor MCP configuration](https://docs.cursor.com/context/model-context-protocol)
- [Claude Code skills and slash commands](https://code.claude.com/docs/en/slash-commands)
- [Gemini CLI custom commands](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/custom-commands.md)
- [Codex skills](https://developers.openai.com/plugins/concepts/skills)
