# Wiki.js MCP Server

MCP-Server, der eine **Wiki.js-2.x**-Instanz als Tools bereitstellt — gedacht für die Nutzung mit **Mattermost Agents**, funktioniert aber mit jedem MCP-Client (Streamable HTTP oder stdio).

Wiki.js wird über seine **GraphQL-API** (`/graphql`) mit einem Bearer-API-Key angesprochen.

## Tools

| Tool | Beschreibung |
| --- | --- |
| `wiki_list_pages` | Seiten auflisten (mit **Pfad-Präfix-Filter**, Sortierung, Tag- und Locale-Filter) |
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
- **Such-Fallback**: Liefert der Wiki.js-Suchindex 0 Treffer (die Standard-„Database"-Engine findet Begriffe im Seiteninhalt oft nicht), scannt der Server die Seiteninhalte direkt (bis 200 Seiten) und liefert Treffer inkl. Text-Snippet. Pfadfilter werden dabei normalisiert (`CTF2026` → `ctf2026`).
- **Pfad-Präfix-Filter**: `wiki_list_pages` und `wiki_search` nehmen ein optionales `path`. Es wirkt als Präfix über ganze Pfadsegmente, nicht als `startsWith` — `ctf2026` liefert `ctf2026` und `ctf2026/...`, aber niemals `ctf20260`, `ctf2026-old` oder `foo/ctf2026`. Bei `wiki_list_pages` wird erst gefiltert und dann `limit` angewendet, `limit: 100` liefert also bis zu 100 **passende** Seiten.
- **Unscharfe Pfad-Auflösung**: Schlägt `wiki_get_page` mit einem Pfad fehl, wird er tolerant gegen die echte Seitenliste gematcht — Groß-/Kleinschreibung, Punkt-vs-Bindestrich (`10-0-0-0-27` findet `10.0.0.0-27`) und Locale-Unterschiede werden aufgelöst; bei Beinahe-Treffern werden existierende ähnliche Seiten mit ihren IDs vorgeschlagen.

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
| `WIKIJS_BASE_URL` | Adresse, unter der **der Server** die GraphQL-API erreicht (ohne `/graphql`) | — (Pflicht) |
| `WIKIJS_URL` | Öffentliche Browser-URL für die `url`-Felder der Seiten | leer (= `WIKIJS_BASE_URL`) |
| `WIKIJS_API_KEY` | API-Key aus Wiki.js | — (Pflicht) |
| `WIKIJS_DEFAULT_LOCALE` | Standard-Locale für Seiten | `en` |
| `WIKIJS_READ_ONLY` | `true` = keine Schreib-Tools | `false` |
| `WIKIJS_PATH_PREFIX` | Harte Bereichsgrenze für **alle** Page-Tools (siehe unten) | leer (unbeschränkt) |
| `MCP_TRANSPORT` | `http` oder `stdio` | `http` |
| `MCP_HTTP_HOST` / `MCP_HTTP_PORT` | Bind-Adresse des HTTP-Endpunkts | `0.0.0.0` / `3123` |
| `MCP_AUTH_TOKEN` | Optionaler Bearer-Token zum Schutz des Endpunkts (empfohlen) | leer |
| `MCP_SERVER_NAME` | Anzeigename des Servers | `wikijs-mcp-server` |

### Interne API-Adresse vs. öffentliche Links

Jede zurückgegebene Seite enthält ein `url`-Feld, das der Agent als Quelle zitiert. Läuft der Server im selben Docker-Netz wie Wiki.js, erreicht er die API oft unter einem internen Namen, den ein Benutzer im Browser nicht öffnen kann. Dafür gibt es zwei getrennte Variablen:

```bash
WIKIJS_BASE_URL=http://wiki:3000          # nur für die GraphQL-API des Servers
WIKIJS_URL=https://wiki.hacktober.ch      # nur für die zitierten Links
```

Ergebnis:

```
http://wiki:3000/graphql                                        <- API-Aufrufe
https://wiki.hacktober.ch/en/CTF2025/hosts/10-10-20-12-dev3     <- url-Feld
```

Ist `WIKIJS_URL` leer oder nicht gesetzt, wird `WIKIJS_BASE_URL` verwendet — bestehende Setups ändern sich also nicht. Ein abschließender Slash wird entfernt.

## Pfad-Präfix-Filter (`wiki_list_pages`)

`wiki_list_pages` hat einen optionalen Parameter `path`. Er ist ein **Pfad-Präfix**, kein Tag und kein Wildcard-Muster:

```json
{ "path": "CTF2026", "limit": 100, "orderBy": "PATH" }
```

Zurück kommen genau die Seiten, deren Pfad **gleich** dem Präfix ist oder **mit `<präfix>/` beginnt**:

| Pfad | im Ergebnis? |
| --- | --- |
| `CTF2026` | ja |
| `CTF2026/hosts` | ja |
| `CTF2026/network/hosts` | ja |
| `CTF2026/writeups/box1` | ja |
| `CTF2025/hosts` | nein |
| `CTF20260/test` | nein |
| `CTF2026-old` | nein |
| `foo/CTF2026` | nein |

Regeln:

- `path` ist **optional**. Ohne `path` verhält sich das Tool exakt wie vorher.
- `CTF2026`, `/CTF2026`, `CTF2026/` und `/en/CTF2026` werden identisch normalisiert (→ `ctf2026`).
- **Keine Wildcards.** `*` oder `ctf2026/*` sind falsch; ein `*` wird als „kein Filter" behandelt, damit ältere Bots keinen Fehler bekommen.
- `limit` ist ein **Integer** (`100`, nicht `"100"`), Bereich 1–500. Der Filter greift **vor** dem Limit, `limit: 100` liefert also bis zu 100 passende Seiten statt 100 global gelesener.
- `tags`, `orderBy` und `locale` verhalten sich unverändert und lassen sich mit `path` kombinieren.

Wiki.js selbst kann in `pages.list` nicht nach Pfad-Präfix filtern; der Filter läuft deshalb im MCP-Server, direkt auf der Ergebnisliste.

## Harte Bereichsgrenze (`WIKIJS_PATH_PREFIX`)

Für Setups, in denen ein Agent (z. B. in einem Mattermost-Channel) **nur** einen Wiki-Bereich sehen und verändern darf:

```bash
WIKIJS_PATH_PREFIX=CTF2026
```

Ist die Variable gesetzt, gilt für alle Page-Tools:

| Tool | Verhalten |
| --- | --- |
| `wiki_list_pages` | liefert ausschließlich Seiten im Präfix; ein zusätzliches `path` kann nur weiter einschränken |
| `wiki_search` / `wiki_search_pages` | sucht ausschließlich im Präfix, inkl. Wildcard-Abfrage und Content-Scan-Fallback |
| `wiki_get_page` | verweigert Seiten außerhalb des Präfix (per ID **und** per Pfad) |
| `wiki_create_page` | verweigert Zielpfade außerhalb des Präfix |
| `wiki_update_page` | verweigert Änderungen an Seiten außerhalb des Präfix **und** das Verschieben einer Seite hinaus |
| `wiki_delete_page` | verweigert das Löschen außerhalb des Präfix |

Es gilt dieselbe Segment-Regel wie beim `path`-Filter (`ctf2026` bzw. `ctf2026/...`, aber nicht `ctf20260` oder `ctf2026-old`), und Slashes sowie ein Locale-Präfix werden normalisiert. Ist `WIKIJS_PATH_PREFIX` leer oder nicht gesetzt, bleibt das Verhalten unverändert unbeschränkt.

Abgelehnte Aufrufe liefern eine erklärende Fehlermeldung samt Vorschlag, z. B.:

```
ERROR: Refused: this server is restricted to the wiki section "ctf2026".
The requested path "infrastructure/backup" is outside that section.
Did you mean "ctf2026/infrastructure/backup"?
```

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

### Beispiel-Tool-Aufrufe

Alle Seiten eines Bereichs auflisten:

```json
{ "name": "wiki_list_pages", "arguments": { "path": "CTF2026", "limit": 100, "orderBy": "PATH" } }
```

Das ganze Wiki auflisten (unverändertes Verhalten):

```json
{ "name": "wiki_list_pages", "arguments": { "limit": 50 } }
```

Nur Writeups mit Tag im Bereich:

```json
{ "name": "wiki_list_pages", "arguments": { "path": "ctf2026", "tags": ["writeup"] } }
```

Falsch — Wildcards und String-Zahlen:

```json
{ "name": "wiki_list_pages", "arguments": { "path": "*", "limit": "50" } }
```

`"*"` wird als „kein Filter" behandelt und `"50"` wird noch toleriert; korrekt sind `"path": "ctf2026"` und `"limit": 50`. Wirklich ungültige Werte (`"limit": "viele"`, `"limit": 2.5`, `"orderBy": "SIDEWAYS"`) werden mit einer klaren Validierungsmeldung abgelehnt.

## Tests

```bash
npm test
```

Führt die Node-eigene Test-Runner-Suite (`node --test`) über `test/` aus. Abgedeckt sind unter anderem: Pfad-Normalisierung, Segment-genaues Präfix-Matching (inkl. `CTF20260` / `CTF2026-old`), `wiki_list_pages` mit und ohne `path`, Filter-vor-Limit, Typprüfung von `limit`/`orderBy`, Kombination von `tags` und `path` sowie die Durchsetzung von `WIKIJS_PATH_PREFIX` in allen sechs Page-Tools.

## Hinweise

- Page-IDs sind in Wiki.js **Integer** (keine UUIDs).
- Pfade werden **ohne** führenden Slash und ohne Locale-Präfix angegeben (`infrastruktur/backup`, nicht `/de/infrastruktur/backup`).
- Wiki.js 3.x hat ein inkompatibles GraphQL-Schema und wird von diesem Server nicht unterstützt.
