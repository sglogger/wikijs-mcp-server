# Wiki.js MCP Server

MCP-Server, der eine **Wiki.js-2.x**-Instanz als Tools bereitstellt — gedacht für die Nutzung mit **Mattermost Agents**, funktioniert aber mit jedem MCP-Client (Streamable HTTP oder stdio).

Wiki.js wird über seine **GraphQL-API** (`/graphql`) mit einem Bearer-API-Key angesprochen.

## Tools

| Tool | Beschreibung |
| --- | --- |
| `wiki_list_pages` | Seiten auflisten (mit Sortierung, Tag- und Locale-Filter) |
| `wiki_get_page` | Eine Seite per numerischer ID oder Pfad vollständig lesen |
| `wiki_search` | Volltextsuche über das Wiki (`"*"` = alle Seiten; Alias: `wiki_search_pages`) |
| `wiki_create_page` | Neue Seite anlegen (Markdown) |
| `wiki_update_page` | Bestehende Seite aktualisieren (Achtung: `content` ersetzt den gesamten Inhalt) |
| `wiki_delete_page` | Seite unwiderruflich löschen |

Mit `WIKIJS_READ_ONLY=true` werden nur die drei Lese-Tools registriert.

Alle Tools und Parameter sind ausführlich beschrieben (inkl. Beispielen und Workflow-Hinweisen), damit auch schwächere LLMs die Schnittstelle zuverlässig nutzen. Zusätzlich macht der Server vage Anweisungen wie „erstelle eine Seite mit ssh-dummy-accounts" robust:

- **Server-Instructions**: Beim MCP-Handshake bekommt der Client einen Workflow-Leitfaden (erst suchen, Struktur ansehen, vollständiges Markdown schreiben, dann anlegen).
- **Auto-Pfad**: Bei `wiki_create_page` ist `path` optional und wird aus dem Titel abgeleitet („SSH Dummy Accounts" → `ssh-dummy-accounts`).
- **Pfad-Normalisierung**: Führende Slashes, Locale-Präfixe, URLs, Umlaute, Leerzeichen und Großschreibung werden automatisch bereinigt (`/de/Infrastruktur/Backup Konzept` → `infrastruktur/backup-konzept`).
- **Duplikat-Schutz**: Existiert am Zielpfad schon eine Seite, schlägt `wiki_create_page` fehl und nennt die vorhandene Seiten-ID mit dem Hinweis, stattdessen `wiki_update_page` zu nutzen.

## Voraussetzungen

- Node.js 20+ (oder Docker)
- eine laufende Wiki.js-2.x-Instanz
- ein Wiki.js-API-Key: **Administration → API Access → API aktivieren → New API Key**

## Konfiguration

```bash
cp .env.example .env
```

| Variable | Bedeutung | Default |
| --- | --- | --- |
| `WIKIJS_BASE_URL` | Basis-URL der Wiki.js-Instanz (ohne `/graphql`) | — (Pflicht) |
| `WIKIJS_API_KEY` | API-Key aus Wiki.js | — (Pflicht) |
| `WIKIJS_DEFAULT_LOCALE` | Standard-Locale für Seiten | `en` |
| `WIKIJS_READ_ONLY` | `true` = keine Schreib-Tools | `false` |
| `MCP_TRANSPORT` | `http` oder `stdio` | `http` |
| `MCP_HTTP_HOST` / `MCP_HTTP_PORT` | Bind-Adresse des HTTP-Endpunkts | `0.0.0.0` / `3123` |
| `MCP_AUTH_TOKEN` | Optionaler Bearer-Token zum Schutz des Endpunkts (empfohlen) | leer |
| `MCP_SERVER_NAME` | Anzeigename des Servers | `wikijs-mcp-server` |

## Starten

```bash
npm install
npm run build
npm start          # HTTP-Modus auf Port 3123
```

Entwicklung mit Auto-Reload:

```bash
npm run dev
```

Mit Docker Compose:

```bash
cp docker-compose.example.yml docker-compose.yml
cp .env.example .env    # Werte anpassen
docker compose up -d
```

Der MCP-Endpunkt ist dann `http://<host>:3123/mcp`, ein Healthcheck liegt auf `GET /healthz`.

## Einrichtung in Mattermost

Mattermost Agents bindet externe MCP-Server über **Streamable HTTP** an (stdio wird nicht unterstützt — deshalb ist `http` hier der Default-Transport).

1. Diesen Server so starten, dass er vom Mattermost-Server aus erreichbar ist (`MCP_AUTH_TOKEN` setzen!).
2. In Mattermost: **System Console → Plugins → Agents → Model Context Protocol (MCP)**.
3. **Add Remote MCP Server** wählen:
   - **URL**: `http://<host>:3123/mcp`
   - **Custom Headers** (wenn `MCP_AUTH_TOKEN` gesetzt): `Authorization` = `Bearer <dein-token>`
4. Speichern — die `wiki_*`-Tools stehen dem Agent anschließend in Mattermost-Channels zur Verfügung.

## Lokal testen

MCP-Handshake per curl:

```bash
curl -s -X POST http://localhost:3123/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

Für lokale stdio-Clients (z. B. Claude Code): `MCP_TRANSPORT=stdio` setzen und den Prozess `node dist/server.js` als MCP-Server eintragen.

## Hinweise

- Page-IDs sind in Wiki.js **Integer** (keine UUIDs).
- Pfade werden **ohne** führenden Slash und ohne Locale-Präfix angegeben (`infrastruktur/backup`, nicht `/de/infrastruktur/backup`).
- Wiki.js 3.x hat ein inkompatibles GraphQL-Schema und wird von diesem Server nicht unterstützt.
