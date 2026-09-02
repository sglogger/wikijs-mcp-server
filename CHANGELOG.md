# Changelog

Alle nennenswerten Änderungen an diesem Projekt. Das Format folgt lose
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionierung
[Semantic Versioning](https://semver.org/lang/de/).

## [0.7.0]

### Hinzugefügt

- **`WIKIJS_URL`** — öffentliche, im Browser erreichbare Wiki-URL für die
  `url`-Felder der zurückgegebenen Seiten. Nötig, wenn der Server Wiki.js unter
  einer internen Adresse erreicht (z. B. `http://wiki:3000` im Docker-Netz),
  Benutzer das Wiki aber unter einer anderen öffnen. Ohne Wert wird weiterhin
  `WIKIJS_BASE_URL` verwendet.
- `WIKIJS_URL` und `WIKIJS_PATH_PREFIX` sind jetzt auch in
  `docker-compose.example.yml` dokumentiert.

### Geändert

- **`WIKIJS_BASE_URL` hat nur noch eine Aufgabe**: die GraphQL-API
  (`${WIKIJS_BASE_URL}/graphql`). Zuvor war sie zusätzlich die Basis der
  zitierten Links, was in Docker-Setups zu nicht anklickbaren Quellen wie
  `http://wiki:3000/en/...` führte.

### Behoben

- Ein leerer Wert (`WIKIJS_URL=` in der `.env`) gilt als „nicht gesetzt" statt
  als ungültige URL und verhindert den Start nicht mehr. Ein echter Fehlwert
  wird weiterhin beim Start mit klarer Meldung abgelehnt.
- Die Testsuite ist hermetisch: eine vorhandene `.env` im Checkout beeinflusst
  `npm test` nicht mehr.

## [0.6.0]

### Hinzugefügt

- **`WIKIJS_PATH_PREFIX`** — optionale harte Bereichsgrenze. Ist sie gesetzt,
  arbeiten alle sechs Page-Tools ausschließlich innerhalb dieses Pfads:
  `wiki_list_pages` und `wiki_search` liefern nur Seiten darin,
  `wiki_get_page`, `wiki_create_page`, `wiki_update_page` und
  `wiki_delete_page` verweigern Pfade außerhalb, und `wiki_update_page` lehnt
  auch das Verschieben einer Seite aus dem Bereich heraus ab. Weder die
  unscharfe Pfad-Auflösung noch der wiki-weite Such-Fallback können den Bereich
  umgehen.
- Testsuite (`npm test`, `node --test`) über die Pfad-Helfer und — via
  MCP-In-Memory-Transport und einem Fake-Wiki.js-Client — über die Tools selbst.
- `src/paths.ts` bündelt Pfad-Normalisierung und Präfix-Vergleich für
  Config-Layer, Client und Tools.

### Geändert

- `limit` und die `id`-Parameter nutzen ein striktes Integer-Schema. Das
  veröffentlichte JSON-Schema meldet `"integer"`, Ziffern-Strings bleiben zur
  Kompatibilität mit bestehenden Bots erlaubt, und `"*"`, `"viele"`, `2.5`,
  `true`, `null` sowie Werte außerhalb 1–500 werden mit klarer Meldung
  abgelehnt.
- Die Beschreibung von `wiki_list_pages` sagt jetzt ausdrücklich, dass `path`
  ein Präfix ist, dass Wildcards falsch sind und dass `limit` ein Integer ist —
  inklusive Beispielaufruf.
- `buildServer()` nimmt optional Client, Pfad-Präfix, Public-URL und
  Read-Only-Flag entgegen und startet nur noch dann selbst einen Transport,
  wenn das Modul direkt ausgeführt wird.

### Behoben

- **Der Pfad-Präfix-Filter verglich mit `startsWith`**, dadurch lieferte
  `ctf2026` auch `ctf20260` und `ctf2026-old`. Verglichen werden jetzt ganze
  Pfadsegmente.
- **Das Limit wurde vor dem Filter angewendet**, `limit: 100` bedeutete also
  100 global gelesene und danach gefilterte Seiten. Jetzt wird erst gefiltert,
  dann limitiert, `limit: 100` liefert also bis zu 100 passende Seiten.
- Derselbe `startsWith`-Fehler im direkten Content-Scan-Fallback.

## [0.5.x]

Frühere Entwicklung ohne einzelne Versionsnummern:

- Toleranz gegenüber String-Argumenten (`"true"`, `"a, b"`, `"50"`) und erster,
  noch fehlerhafter `path`-Filter für `wiki_list_pages`.
- `url`-Feld auf jeder zurückgegebenen Seite plus Zitierhinweis in den
  Server-Instructions.
- Unscharfe Pfad-Auflösung für `wiki_get_page` (Groß-/Kleinschreibung,
  Punkt-vs-Bindestrich, Locale-Unterschiede), Punkte bleiben in Slugs erhalten.
- Such-Fallback: direkter Content-Scan, wenn der Wiki.js-Suchindex 0 Treffer
  liefert.
- `wiki_search` als Kurzname mit Alias `wiki_search_pages` und
  Wildcard-Fallback.
- Robustheit gegenüber vagen Prompts: Server-Instructions, automatischer Pfad
  aus dem Titel, Duplikat-Schutz.

## [0.5.0]

- Erste Fassung: Wiki.js-GraphQL-Client, sechs `wiki_*`-Tools, Streamable HTTP
  für Mattermost Agents und stdio für lokale MCP-Clients.
