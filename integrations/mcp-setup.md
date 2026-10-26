# Hubungkan EdGEO ke AI agent

Setelah repository GitHub publik, cara yang disarankan adalah memakai installer:

```sh
npx -y --package=github:edgarcia-id/edgeo edgeo-mcp install --agent claude,codex,cursor,gemini
```

Perintah itu menambahkan server stdio bernama `edgeo` pada konfigurasi user-level. Ia menjaga server lain, membuat cadangan untuk file JSON, dan memasang skill pada Claude Code dan Codex. Jalankan `edgeo-mcp doctor` untuk memeriksa deteksi lokal dan `edgeo-mcp uninstall --agent ...` untuk melepas konfigurasi EdGEO.

## Instalasi manual

Semua contoh memakai proses lokal `npx`. Host akan mengambil source dari repository GitHub dan membangun `dist/` melalui lifecycle `prepare` npm.

### Claude Code

```sh
claude mcp add --scope user --transport stdio edgeo -- npx -y --package=github:edgarcia-id/edgeo edgeo-mcp serve
```

Untuk skill `/edgeo`, salin `integrations/edgeo.skill.md` ke `~/.claude/skills/edgeo/SKILL.md`.

### Codex

```sh
codex mcp add edgeo -- npx -y --package=github:edgarcia-id/edgeo edgeo-mcp serve
```

Untuk skill `$edgeo`, salin `integrations/edgeo.skill.md` ke `$CODEX_HOME/skills/edgeo/SKILL.md` (umumnya `~/.codex/skills/edgeo/SKILL.md`).

### Cursor

Gabungkan objek berikut pada `~/.cursor/mcp.json` dan pertahankan isi JSON yang sudah ada:

```json
{
  "mcpServers": {
    "edgeo": {
      "command": "npx",
      "args": ["-y", "--package=github:edgarcia-id/edgeo", "edgeo-mcp", "serve"]
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
      "args": ["-y", "--package=github:edgarcia-id/edgeo", "edgeo-mcp", "serve"]
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
