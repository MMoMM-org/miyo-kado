# Kado v1 – Designentwurf (Ansatz A: Obsidian-API-First)

## 1. Ziel und Positionierung

Kado ist ein sicherheitsfokussierter **MCP-Server als Obsidian-Plugin**, der AI-Agents einen kontrollierten Zugriff auf einen Obsidian-Vault ermöglicht.  
Im Unterschied zu „alles darf alles“-Lösungen (Claude Code direkt im Vault, unbeschränkte MCP-Server) definiert Kado für jeden API-Key klar, **welche Bereiche des Vaults mit welchen Rechten** (CRUD) zugänglich sind.

Kernprinzipien:

- **Security-first**: Default-Deny, explizite Whitelists, getrennte Rechte für Notes, Frontmatter, andere Dateien.
- **Obsidian-API-First**: So wenig eigene Logik wie möglich; maximale Nutzung von Obsidian-APIs, Caches und vorhandenen Suchmöglichkeiten.
- **Multi-Client-fähig**: Mehrere AI-Clients/Agenten (z.B. Tomo, Satelliten, andere Repos) können gleichzeitig über Kado zugreifen.
- **Korrektheit vor Geschwindigkeit**: Suchergebnisse sollen vollständig und exakt sein; Performance wird über Chunking/Throttling gesteuert.

---

## 2. Betriebsmodell

- Kado läuft als **Obsidian-Plugin** und stellt einen **MCP-Server nach außen** bereit.
- Standardmäßig bindet sich der Server an `localhost`; optional kann eine **konfigurierbare IP** genutzt werden.
- Transport:
  - v1: Klartext TCP/HTTP innerhalb des lokalen Netzwerks; der Nutzer ist für Absicherung zwischen Rechnern verantwortlich.
  - HTTPS mit Self-Signed Certificates ist „nice-to-have“, aber **nicht** Teil des minimalen v1-Scopes (Parking Lot).

---

## 3. Datenarten und Zugriff

Kado unterscheidet drei Datenarten:

1. **Notes (.md)**
2. **Frontmatter** innerhalb von Markdown-Dateien
3. **Andere Dateien** (z.B. .pdf, Bilder, sonstige Assets)

### 3.1 Rechte-Logik (RBAC-Grundsatz)

Für jede Datenart werden **eigene CRUD-Rechte** vergeben, unabhängig voneinander:

- Note: C, R, U, D
- Frontmatter: C, R, U, D
- Andere Dateien: C, R, U, D

Zusätzlich noch Funktionen die über RBAC gesteuert werden:

- TagSuche
- Volltext Suche

Designentscheidung:

- **Frontmatter und Note-Rechte sind unabhängig.**
- Note-Operationen arbeiten immer auf der ganzen Datei (inkl. Frontmatter).  
  - Wenn Note-Write/Update erlaubt ist, darf der Client den gesamten Dateiinhalt (inkl. Frontmatter) verändern.
  - Es gibt **keine Schutzschicht**, die verhindert, dass Note-Write indirekt Frontmatter ändert.
- Frontmatter-Operationen sind **auf das Frontmatter-Segment beschränkt**:
  - Ein Frontmatter-Update-Tool ändert ausschließlich Frontmatter, nicht den restlichen Note-Text.

Tags werden als Teil von Note/Frontmatter verstanden:

- Lesen von Tags erfolgt über Note/Frontmatter-Read.
- Änderungen an Tags passieren implizit über Note-/Frontmatter-Änderungen; es gibt kein separates Tag-CRUD in v1.

---

## 4. Konfigurationsmodell

Kado trennt zwischen **Global Config** (Obsidian-Seite) und **API-Key-spezifischer Config** (pro „Nutzer“/Client).

### 4.1 Global Config (Obsidian-Seite)

1. **Server-Bindung**
   - Option „localhost only“ oder „an spezifische IP binden“.
2. **Globaler Zugriffsscope**
   - Grundmodus: Default-Deny (nichts erlaubt).
   - Konfiguration über **Whitelist/Blacklist-Toggle**:
     - „Whitelist-Modus“: Nur explizit erlaubte Bereiche (Ordner/Pfade) sind für MCP grundsätzlich erreichbar.
     - „Blacklist-Modus“: Alles ist grundsätzlich erreichbar, außer explizit verbotene Bereiche (optional für spätere Version, für v1 kann Whitelist reichen, falls gewünscht).
3. **Global definierte Bereiche**
   - Definition von **Bereichen** (z.B. Ordner, Pfadpattern), denen globale CRUD-Rechte für Notes/Frontmatter/andere Dateien zugeordnet werden.
   - Diese Bereiche dienen als **Bausteine**, die API-Configs später nutzen oder einschränken können.
4. **API-Key-Verwaltung**
   - Erzeugen, Auflisten, Deaktivieren/Revoken von API-Keys.
   - Anzeigen der zugehörigen sprechenden Namen und zugewiesenen Rechte.

### 4.2 API-Config (pro API-Key)

Pro API-Key gibt es eine eigene Konfigurationsebene:

1. **Sprechender Name**
   - Jeder API-Key erhält einen beschreibenden Namen (z.B. „Tomo-Companion“, „Repo X – Build-Agent“), um die Zuordnung zu erleichtern.
2. **API-spezifischer Zugriffsscope**
   - Eigener **Whitelist/Blacklist-Toggle**, ebenfalls mit Default-Deny.
   - API-spezifische Einschränkung/Auswahl von **Bereichen**, die in der Global Config definiert wurden:
     - Ein API-Key kann nur innerhalb der global erlaubten Bereiche arbeiten.
     - Innerhalb dieser Bereiche können pro API-Key **feinere CRUD-Rechte** gesetzt oder bestimmte Bereiche komplett ausgeschlossen werden.
3. **RBAC-Details**
   - Pro API-Key und Bereich werden die CRUD-Rechte getrennt für:
     - Notes
     - Frontmatter
     - Andere Dateien
   - Die Kombination aus Global Config + API-Config bestimmt endgültig, was ein Key darf.

---

## 5. Tools und Funktionsumfang v1

### 5.1 Datei-Operationen (CRUD)

Für alle MCP-Tools gilt:  
Zuerst erfolgt die **Sicherheitsprüfung** (Global + API-Key-RBAC). Nur wenn diese erfolgreich ist, wird die Anfrage ausgeführt oder in eine Warteschlange aufgenommen.

**Notes (.md):**

- Read:
  - Lesen einer einzelnen Note (inkl. Frontmatter).
- Create:
  - Erstellen einer neuen Note in einem erlaubten Bereich.
- Update:
  - Überschreiben/Ändern des gesamten Note-Inhalts (inkl. Frontmatter, falls der Client das tut).
- Delete:
  - Löschen einer Note.

**Frontmatter:**

- Read:
  - Lesen des Frontmatter-Blocks einer Note.
- Create/Update:
  - Setzen/Ändern des Frontmatter (z.B. Felder hinzufügen/aktualisieren).
- Delete:
  - Entfernen von spezifischen Frontmatter-Feldern oder des gesamten Frontmatter-Blocks (Designdetail noch festzulegen).

**Andere Dateien:**

- Read:
  - Lesen/Bereitstellen binärer Dateien (z.B. für AI-Analyse).
- Create/Update:
  - Erstellen oder Ersetzen von Dateien.
- Delete:
  - Löschen von Dateien.

### 5.2 Suche und Auflistung

Ziel: **Vollständige und exakte Ergebnisse**, Performance über Chunking/Throttling.

Suche basiert primär auf:

- **Directory-Struktur** (Ordner/Pfade).
- **Dateinamen** (inkl. Pattern/Wildcards).
- **Tags** (via Obsidian-Metadaten).
- **Inhalt** (Note-Text, optional inkl. Frontmatter).

Grundprinzip:

- Kado nutzt **Obsidian-APIs und Caches**, wo immer möglich (Vault-Listing, Metadata-Cache, ggf. vorhandene Suchfunktionen).
- Wo nötig, ergänzt Kado durch **gezielte on-demand File-Reads**, immer beschränkt auf:
  - Global + API-spezifische Bereiche.
  - Chunked/Seitenweise Resultsets (z.B. „page“/„cursor“-basiert).

**Beispiele für v1-Suchtools:**

- Liste Dateien in einem Pfad (mit optionalem Filter nach Dateityp).
- Finde Notes mit bestimmten Tags.
- Volltextsuche in Notes (und optional Frontmatter), chunked.
- Auflisten von Notes/Dateien im Scope eines API-Keys (zur Navigation).

Persistente, globale Indizes sind **nicht Teil von v1** (siehe Parking-Lot).

---

## 6. Performance- und Ausführungsmodell

- **Fail-Fast-Security**:
  - Jede Anfrage wird **zuerst** gegen Global Config + API-Config geprüft.
  - Nicht erlaubte Anfragen werden sofort abgelehnt, ohne in Queues zu landen.
- **Queueing für lange Operationen**:
  - Erlaubte, aber potenziell lange laufende Aufgaben (z.B. große Suchläufe) können in eine interne Queue eingestellt werden, um Obsidian reaktionsfähig zu halten.
- **Chunking/Throttling**:
  - Große Resultsets werden in logisch zusammenhängenden Chunks zurückgegeben.
  - Clients (AI-Agents) können über Cursor/Offsets weitere Chunks nachladen.
- **Obsidian-API-First**:
  - Kado nutzt die Vault-API, Metadata-Caches etc., statt eigene vollständige Vault-Scans zu implementieren.
  - Eigene Scans sind nur dort vorgesehen, wo Obsidian keine passende Funktion bietet und werden dann strikt gescopet.

---

## 7. Nicht-Ziele von Kado v1

- **Kein persistenter globaler Index**:
  - Kein dauerhafter On-Disk-Index, keine eigene Suchdatenbank.
- **Keine RAG-/Vektor-Suche**:
  - Kein Semantic/RAG-Index; keine Vektor-Datenbank-Anbindung.
- **Keine Content-bewussten Schutzschichten**:
  - Es gibt keine zusätzliche Logik, die z.B. bei `Frontmatter: R` verhindert, dass ein erlaubter Note-Write Frontmatter indirekt ändert.
- **Keine komplexe Netzwerksicherheit**:
  - HTTPS/TLS, Zertifikatsverwaltung etc. sind bewusst nicht Teil des v1-MVP.
- **Keine Mehr-Rechner-Koordination**:
  - Kado v1 koordiniert keinen gemeinsamen Zustand über mehrere Obsidian-Instanzen hinweg.

---

## 8. Parking Lot (bewusste spätere Erweiterungen)

Folgende Themen werden explizit **nicht** in Kado v1 gelöst, sondern sind Kandidaten für spätere Spezifikationen (ggf. eigenes „Index-/RAG-Plugin“):

1. **Persistenter Index + Change-Tracking**
   - On-Disk-Index für Notes/Frontmatter/Tags/Inhalt.
   - Robustes Change-Tracking (inkl. Obsidian Sync und anderen Sync-Mechanismen).
   - Konsistenz über mehrere Obsidian-Instanzen hinweg.

2. **RAG-/AI-optimierter Index**
   - Vektor-Suche, Chunking für semantische Queries.
   - Spezielles Plugin oder separater Dienst, auf den Kado zugreifen kann.

3. **HTTPS/TLS-Unterstützung**
   - Optionale Transportverschlüsselung (Self-Signed Certificates, konfigurierbare Trust-Roots).
   - Vereinfachte Zertifikats- bzw. Schlüsselverwaltung.

4. **Feinere Policy-Ebenen**
   - Feldgenaue Frontmatter-Policies (z.B. bestimmte Felder nur R).
   - Tag-spezifische Rechte (z.B. Dateien mit bestimmten Tags nur für bestimmte Keys sichtbar).

5. **Erweiterte Observability**
   - Detaillierte Metriken zu Performance, Nutzung und Fehlertypen.
   - Export/Integration mit externen Monitoring-Systemen.
