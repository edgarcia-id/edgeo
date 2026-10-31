# Hubungkan EdGEO ke AI agent

Gunakan installer dari paket npm yang telah diterbitkan:

```sh
npx --yes --prefer-online edgeo-mcp@latest install --agent claude,codex,cursor,gemini
```

Perintah itu menambahkan server stdio bernama `edgeo` pada konfigurasi user-level. Ia menjaga server lain, membuat cadangan untuk file JSON, dan memasang skill pada Claude Code dan Codex. Jalankan `edgeo-mcp doctor` untuk memeriksa deteksi lokal dan `edgeo-mcp uninstall --agent ...` untuk melepas konfigurasi EdGEO.

## Instalasi manual

Semua contoh memakai proses lokal `npx` dan paket npm yang telah diterbitkan.

### Claude Code

```sh
claude mcp add --scope user --transport stdio edgeo -- npx --yes --prefer-online edgeo-mcp@latest serve
```

Untuk skill `/edgeo`, salin `integrations/edgeo.skill.md` ke `~/.claude/skills/edgeo/SKILL.md`.

### Codex

```sh
codex mcp add edgeo -- npx --yes --prefer-online edgeo-mcp@latest serve
```

Untuk skill `$edgeo`, salin `integrations/edgeo.skill.md` ke `$CODEX_HOME/skills/edgeo/SKILL.md` (umumnya `~/.codex/skills/edgeo/SKILL.md`).

### Cursor

Gabungkan objek berikut pada `~/.cursor/mcp.json` dan pertahankan isi JSON yang sudah ada:

```json
{
  "mcpServers": {
    "edgeo": {
      "command": "npx",
      "args": ["--yes", "--prefer-online", "edgeo-mcp@latest", "serve"]
    }
  }
}
```

### Gemini CLI

Gabungkan objek berikut pada `~/.gemini/settings.json` dan pertahankan isi konfigurasi lain:

```json
{
  "mcpServers": {
    "edgeo": {
      "command": "npx",
      "args": ["--yes", "--prefer-online", "edgeo-mcp@latest", "serve"]
    }
  }
}
```

Gemini CLI dapat menampilkan prompt MCP `edgeo` sebagai `/edgeo` bila versi client mendukungnya.

## Koneksi opsional

- Search Console baca-saja: ikuti [panduan Search Console](../docs/search-console.md), lalu jalankan `edgeo-mcp search-console connect --client-id ...`.
- Ollama lokal: jalankan Ollama di `127.0.0.1:11434`, lalu panggil `edgeo_query_model` dengan provider `ollama`.
- Gemini API: konfigurasi `GEMINI_API_KEY` pada proses MCP dan isi `consentToExternalRequest: true` sebelum prompt dikirim.

MCP standar tidak menjamin satu sintaks slash-command universal. Beberapa agent memakai skill, prompt picker, atau tool invocation biasa.

## Pembaruan otomatis

Konfigurasi MCP di atas mengecek rilis npm terbaru setiap kali agent memulai server dan mengunduh versi terbaru jika tersedia. Proses MCP yang sudah berjalan tetap memakai versi aktifnya; muat ulang atau mulai ulang agent untuk memakai pembaruan.

Untuk plugin Claude Code, buka `/plugin`, pilih **Marketplaces → edgeo-marketplace**, lalu aktifkan **Auto-update**. Claude Code mematikan auto-update untuk marketplace pihak ketiga secara default. Claude Code memeriksa update marketplace saat startup dan memberi tahu jika plugin berubah; jalankan `/reload-plugins` atau buka sesi baru untuk memakai command yang diperbarui.

Setiap tag GitHub yang cocok dengan versi pada `package.json` akan menerbitkan versi npm, memperbarui listing Official MCP Registry, lalu membuat GitHub Release. Sebelum publikasi otomatis pertama, atur [npm trusted publisher](https://docs.npmjs.com/trusted-publishers/) untuk GitHub Actions, repo `edgarcia-id/edgeo`, workflow `release.yml`, dan izin publish.
