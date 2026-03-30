# PRD – Kado v1 (Obsidian MCP Gateway)

---

## 1. Product Overview

### Vision
Kado macht den Einsatz von AI‑Agenten in Obsidian für sicherheitsbewusste Nutzer alltagstauglich, indem es als fein steuerbarer Gateway zwischen Vault und AI fungiert – ohne Kompromisse bei Kontrolle oder Transparenz.

### Problem Statement
Heute müssen Nutzer, die AI‑Tools mit ihrem Obsidian‑Vault verbinden wollen, entweder auf generische MCP‑Server oder direkte IDE‑Integrationen zurückgreifen, die den Agents oft weitreichenden oder vollständigen Zugriff auf alle Inhalte geben. Das führt zu berechtigter Angst davor, dass sehr persönliche Daten, sensible Notizen oder wichtige Projektdokumente ungewollt gelesen, überschrieben oder gelöscht werden. Viele Nutzer verzichten deshalb ganz auf tiefere AI‑Integration oder arbeiten mit umständlichen Workarounds (z.B. separate „AI‑Vaults“), was den Nutzen der Tools deutlich reduziert.

### Value Proposition
Kado ermöglicht es dem Nutzer, exakt zu definieren, welche Bereiche des Vaults eine AI sehen und mit welchen Rechten (CRUD) sie dort agieren darf – getrennt für Notes, Frontmatter und andere Dateien sowie pro API‑Key/Agent. Dadurch können AI‑Agenten produktiv mit dem echten Wissensbestand arbeiten, während der Nutzer keine Angst mehr haben muss, dass private Inhalte versehentlich geteilt oder wichtige Daten unkontrolliert verändert werden.

### Scope of this Feature
Diese PRD beschreibt Kado v1 als Obsidian‑Plugin, das einen lokalen MCP‑Server bereitstellt, globale und API‑Key‑spezifische Zugriffskonfigurationen unterstützt, alle drei Datenarten (Notes, Frontmatter, andere Dateien) abdeckt und Such‑/Listing‑Funktionen mit vollständigen, gechunkten Ergebnissen bereitstellt. Persistente Indizes, RAG‑Funktionen, komplexe Netzwerksicherheit (TLS) und Multi‑Instance‑Koordination sind ausdrücklich außerhalb des v1‑Scopes und werden separat betrachtet.

---

## 2. User Personas

### Primärpersona: Sicherheitsbewusster Knowledge Worker

- **Profil**  
  Arbeitet intensiv mit Obsidian als „zweites Gehirn“: persönliche Reflexion, Kunden- oder Klientennotizen, Projektideen, langfristige Wissenssammlung. Technisch versiert genug, Plugins zu konfigurieren, aber kein Infrastrukturprofi.

- **Ziele**  
  - AI‑Agenten nutzen, um Notizen schneller zu durchsuchen, zusammenzufassen und zu strukturieren.  
  - Sicher sein, dass bestimmte sensible Bereiche (z.B. Tagebuch, Gesundheitsdaten, vertrauliche Kundendaten) niemals von AI gelesen oder geändert werden.  
  - Pro Agent (z.B. Coaching‑Bot, Coding‑Companion) klar trennen können, welche Notizbereiche genutzt werden dürfen.

- **Pain Points**  
  - Misstrauen gegenüber generischen Integrationen, die „alles im Vault“ zugänglich machen.  
  - Angst vor versehentlichem Löschen oder Überschreiben wichtiger Notizen durch AI‑Aktionen.  
  - Umständliche Workarounds (separate Vaults, manuelle Copy/Paste‑Flows), die Zeit kosten und Fehlerquellen schaffen.  
  - Komplexe Sicherheitskonfigurationen, die schwer durchschaubar sind und das Risiko erhöhen, „aus Versehen“ zu viel freizugeben.

### Sekundärpersona 1: Technischer Power-User / Entwickler

- **Profil**  
  Entwickelt Software und nutzt Obsidian als Projektdokumentation (Architektur‑Notizen, Decision Logs, To‑Dos). Bindet mehrere AI‑Tools/IDEs (z.B. Tomo, Repo‑spezifische Agents) an denselben Vault an.

- **Ziele**  
  - Verschiedene Agents mit unterschiedlichen Rechten ausstatten (z.B. Build‑Agent darf Projektordner lesen, aber nicht das private Journal).  
  - Klares Mapping zwischen API‑Keys und Agenten haben, um Verhalten nachvollziehen zu können.  
  - Einheitliche, wiederverwendbare Rechte-Profile für mehrere Repos/Agents.

- **Pain Points**  
  - Fehlende Trennung zwischen Arbeitsbereichen und privaten Bereichen im Vault bei bestehenden MCP‑Servern.  
  - Schwierige Fehlersuche, wenn ein Agent „zu viel“ darf und unerwartete Änderungen vornimmt.  
  - Konfigurationen, die sich nicht gut dokumentieren oder versionieren lassen, sodass später unklar ist, warum ein Agent welche Rechte hatte.

### Sekundärpersona 2: Privacy-sensible Professional (Berater, Coach, Therapeut:in)

- **Profil**  
  Nutzt Obsidian für vertrauliche Klienten- oder Kundendaten und möchte AI zur Vorbereitung, Analyse und Strukturierung dieser Inhalte einsetzen, ohne gegen ethische oder rechtliche Rahmen zu verstoßen.

- **Ziele**  
  - Sicherstellen, dass bestimmte Dossiers oder Ordner nie von AI berührt werden.  
  - Transparent nachvollziehen, welche Inhalte ein bestimmter Agent potenziell gesehen oder geändert haben kann.  
  - Konservative, leicht erklärbare Sicherheitskonfigurationen (z.B. für interne Compliance oder gegenüber Klienten).

- **Pain Points**  
  - Starke Sorge, dass sensible Daten unbeabsichtigt in externe AI‑Kontexte gelangen.  
  - Bestehende Lösungen sind entweder zu grob (alles oder nichts) oder zu technisch, um sie vertrauenswürdig zu konfigurieren.  
  - Fehlende Auditierbarkeit, welche Bereiche eines Vaults einem Agent wann zugänglich waren.

---

## 3. User Journey Maps

### Journey 1 (Primär, Happy Path): Knowledge Worker richtet Kado ein und gibt einem bestehenden Agent gezielt Zugriff

**Auslöser**  
Der Knowledge Worker nutzt bereits einen AI‑Agenten (z.B. Tomo) und möchte diesen mit dem Obsidian‑Vault verbinden, ohne dass der Agent das gesamte „zweite Gehirn“ sehen oder verändern kann.

**Schritte**

1. **Kado installieren und aktivieren**  
   - Nutzer entdeckt Kado im Plugin‑Katalog oder über Dokumentation und installiert das Plugin.  
   - Beim ersten Start erklärt ein kurzes Intro, dass Kado als MCP‑Server fungiert und API‑Key‑basierte Rechteverwaltung bietet.

2. **Globalen Sicherheitsrahmen prüfen**  
   - In der Global Config sieht der Nutzer, dass Kado standardmäßig im Whitelist‑Modus mit „nichts erlaubt“ läuft (Default‑Deny).  
   - Er lässt diesen sicheren Default bestehen und definiert ein oder mehrere globale Bereiche (z.B. „Projects/Client A“, „Notes/Work“), in denen AI‑Zugriff grundsätzlich erlaubt sein darf, und weist dort grobe CRUD‑Rechte zu (z.B. Notes: RU, Frontmatter: RU, Files: R).

3. **API‑Key für den Agent anlegen**  
   - Nutzer erzeugt einen neuen API‑Key und vergibt einen sprechenden Namen wie „Tomo – Work Assistant“.  
   - In der API‑Config wählt er, welche der globalen Bereiche dieser Key nutzen darf, und verfeinert die Rechte (z.B. Notes: R, Frontmatter: RU, Files: R).  
   - Er kopiert den API‑Key und trägt ihn in der Konfiguration des AI‑Clients ein.

4. **Zugriff testen**  
   - Nutzer bittet den Agent im AI‑Tool, eine bestimmte Work‑Note zu finden oder zusammenzufassen.  
   - Der Agent kann nur Notes innerhalb der konfigurierten Bereiche lesen und ggf. aktualisieren; Versuche, auf private Bereiche (z.B. „Journal/Personal“) zuzugreifen, schlagen sichtbar fehl.  
   - Nutzer gewinnt Vertrauen, dass die Zugriffsgrenzen funktionieren.

5. **Kleinschrittige Anpassung bei Bedarf**  
   - Nach ersten Erfahrungen passt der Nutzer Berechtigungen an, z.B. erlaubt er dem Agent, Frontmatter zu bearbeiten (Status‑Felder, Tags), lässt aber Delete‑Rechte vorerst deaktiviert.  
   - Anpassungen sind pro API‑Key nachvollziehbar, ohne dass globale Einstellungen unübersichtlich werden.

**Ergebnis**  
Der Knowledge Worker nutzt seinen bestehenden Agent produktiv mit einem relevanten Teil des Vaults, während sensible Bereiche geschützt bleiben. Er versteht, welche Ordner und Rechte der Agent hat, und kann diese jederzeit feinjustieren, ohne auf separate „AI‑Vaults“ ausweichen zu müssen.

---

## 4. Feature Requirements (MoSCoW)

### Must Have

#### 1. Default-Deny global access model
**User story**  
Als sicherheitsbewusster Obsidian‑Nutzer möchte ich, dass Kado mit keinem freigegebenen Inhalt startet, damit kein AI‑Agent ohne meine explizite Freigabe Zugriff hat.

**Acceptance criteria**
- Given Kado ist neu installiert oder zurückgesetzt, when der Nutzer die Konfiguration öffnet, then sind standardmäßig keine Notes, Frontmatter oder andere Dateien für irgendeinen API‑Key zugänglich.  
- Given keine globalen Bereiche wurden erlaubt, when ein AI‑Agent eine gültig authentifizierte Anfrage stellt, then lehnt Kado den Zugriff auf alle Vault‑Inhalte ab.  
- Given ein Pfad ist nicht explizit global freigegeben, when ein API‑Key Zugriff auf diesen Pfad anfragt, then lehnt Kado die Anfrage ab.

#### 2. Global scope configuration for Vault areas
**User story**  
Als Nutzer möchte ich global erlaubte Vault‑Bereiche definieren können, damit nur ausgewählte Ordner oder Pfad‑Scopes überhaupt für AI‑Zugriff in Frage kommen.

**Acceptance criteria**
- Given der Nutzer ist in der globalen Konfiguration, when er einen erlaubten Bereich definiert, then speichert Kado diesen Bereich als Teil des globalen Zugriffmodells.  
- Given ein Pfad liegt außerhalb aller global erlaubten Bereiche, when ein API‑Key Zugriff auf diesen Pfad anfragt, then lehnt Kado die Anfrage ab.  
- Given ein Pfad liegt global in einem erlaubten Bereich, when kein API‑Key‑Scope ihn freigibt, then bleibt der Zugriff trotzdem verweigert.

#### 3. API-key-based authorization
**User story**  
Als Nutzer möchte ich, dass jeder AI‑Agent mit einem eigenen API‑Key arbeitet, damit ich Berechtigungen pro Agent oder Agentengruppe steuern kann.

**Acceptance criteria**
- Given ein Nutzer erstellt einen API‑Key, when er diesen einem Agent zuweist, then werden Anfragen mit diesem Key anhand der Key‑spezifischen Berechtigungen ausgewertet.  
- Given eine Anfrage wird ohne API‑Key oder mit einem unbekannten Key gesendet, when Kado sie erhält, then wird sie abgelehnt.  
- Given zwei Agents denselben API‑Key nutzen, when sie Anfragen senden, then behandelt Kado sie als dieselbe Berechtigungsidentität.

#### 4. Per-key scoped permissions within global bounds
**User story**  
Als Nutzer möchte ich pro API‑Key eigene erlaubte Scopes innerhalb der globalen Bereiche definieren, damit verschiedene Agents auf unterschiedliche Teile meines Vaults zugreifen können.

**Acceptance criteria**
- Given ein globaler Bereich ist erlaubt, when der Nutzer einen API‑Key‑Scope innerhalb dieses Bereichs konfiguriert, then darf der Key nur in diesem Scope operieren, nicht im gesamten globalen Bereich, sofern nicht explizit freigegeben.  
- Given ein API‑Key hat keinen Scope für einen global erlaubten Bereich, when er Zugriff dort anfragt, then lehnt Kado die Anfrage ab.  
- Given ein API‑Scope versucht, über die globalen Grenzen hinaus zuzugreifen, when Kado die Konfiguration auswertet, then wird der Zugriff auf die global erlaubten Grenzen beschränkt.

#### 5. Independent CRUD permissions by data type
**User story**  
Als Nutzer möchte ich separate CRUD‑Rechte für Notes, Frontmatter und andere Dateien konfigurieren, damit ich genau steuern kann, welche Daten ein AI‑Agent lesen oder verändern darf.

**Acceptance criteria**
- Given ein API‑Key hat Lese‑ aber keine Update‑Rechte für Notes, when er versucht, eine Note zu ändern, then lehnt Kado die Anfrage ab.  
- Given ein API‑Key hat Update‑Rechte für Frontmatter, aber nur Leserechte für Notes, when er ein Frontmatter‑Update‑Tool nutzt, then erlaubt Kado die Änderung des Frontmatters.  
- Given ein API‑Key hat nur Leserechte für andere Dateien, when er versucht, eine nicht‑Markdown‑Datei zu erstellen oder zu löschen, then lehnt Kado die Anfrage ab.

#### 6. Distinct Note and Frontmatter permission model
**User story**  
Als Nutzer möchte ich Frontmatter‑Rechte unabhängig von Note‑Rechten konfigurieren, damit ich Metadaten‑Workflows erlauben kann, ohne volle Kontrolle über den Notizinhalt zu geben.

**Acceptance criteria**
- Given ein API‑Key hat Frontmatter‑Update‑Rechte, when er eine Frontmatter‑spezifische Operation nutzt, then darf er Frontmatter aktualisieren, auch wenn Note‑Update nicht erlaubt ist.  
- Given ein API‑Key hat Note‑Update‑Rechte, when er den Inhalt einer Note ändert, then darf die Operation auch das Frontmatter verändern, weil die gesamte Datei aktualisiert wird.  
- Given ein API‑Key hat keine Frontmatter‑Leserechte, aber Note‑Leserechte, when er die Note über eine Note‑Read‑Operation liest, then erhält er den kompletten Dateiinhalt inklusive eingebettetem Frontmatter.

#### 7. Fail-fast authorization before execution
**User story**  
Als Nutzer möchte ich, dass unautorisierte Operationen abgelehnt werden, bevor Arbeit beginnt, damit unzulässige Anfragen keine Ressourcen verbrauchen oder Risiken erzeugen.

**Acceptance criteria**
- Given eine Anfrage zielt auf einen Pfad oder eine Operation außerhalb der API‑Key‑Rechte, when Kado sie erhält, then wird die Anfrage vor jeglicher Ausführung abgelehnt.  
- Given eine Anfrage ist unautorisiert, when sie ausgewertet wird, then wird sie nicht in eine Warteschlange aufgenommen.  
- Given eine Anfrage ist autorisiert, when die Bewertung abgeschlossen ist, then darf sie in Ausführung oder Queueing übergehen.

#### 8. Auditability of access decisions and file operations
**User story**  
Als Nutzer möchte ich, dass Kado Zugriffsentscheidungen und Dateioperationen protokolliert, damit ich nachvollziehen kann, was ein Agent versucht hat und was erlaubt oder verweigert wurde.

**Acceptance criteria**
- Given Audit‑Logging ist aktiviert, when eine API‑Anfrage verarbeitet wird, then zeichnet Kado auf, ob die Anfrage erlaubt oder verweigert wurde.  
- Given Audit‑Logging ist aktiviert, when eine Dateioperation erfolgreich ist oder fehlschlägt, then protokolliert Kado Metadaten über den Vorgang, ohne sensible Datei‑Inhalte im Log zu speichern.  
- Given der Nutzer deaktiviert Audit‑Logging, when Anfragen verarbeitet werden, then erzeugt Kado keine neuen Audit‑Einträge.

#### 9. Global configuration screen
**User story**  
Als Nutzer möchte ich einen zentralen globalen Konfigurationsbereich in Obsidian, damit ich die Gesamt‑Sicherheitslage von Kado an einem Ort verstehen und steuern kann.

**Acceptance criteria**
- Given Kado ist installiert, when der Nutzer die Einstellungen öffnet, then kann er die globale Konfiguration in einem dedizierten Bereich anzeigen und bearbeiten.  
- Given der Nutzer öffnet die globalen Einstellungen, when noch keine Konfiguration erstellt wurde, then zeigt die Oberfläche klar den Default‑Deny‑Startzustand.  
- Given der Nutzer ändert globale Einstellungen, when er die Änderung speichert oder bestätigt, then nutzt Kado die aktualisierte globale Konfiguration für nachfolgende Requests.

#### 10. Configurable server exposure mode
**User story**  
Als Nutzer möchte ich wählen können, ob Kado nur auf localhost oder auf einer konfigurierten IP erreichbar ist, damit ich den Zugriff an meine lokale oder multi‑device Nutzung anpassen kann.

**Acceptance criteria**
- Given der Nutzer ist in der globalen Konfiguration, when er den Server‑Exposure‑Modus konfiguriert, then kann er zwischen „localhost only“ und einer konfigurierten IP wählen.  
- Given „localhost only“ ist ausgewählt, when der Nutzer die Einstellungen prüft, then zeigt die Oberfläche klar, dass Kado nur lokal erreichbar ist.  
- Given IP‑basiert ist ausgewählt, when der Nutzer die Einstellung anzeigt oder bearbeitet, then ist das konfigurierte Bind‑Target sichtbar und verständlich.

#### 11. Manage global allowed areas
**User story**  
Als Nutzer möchte ich benannte globale Bereiche meines Vaults definieren können, damit ich diese Bereiche als äußere Berechtigungsgrenze für API‑Keys wiederverwenden kann.

**Acceptance criteria**
- Given der Nutzer ist in der globalen Konfiguration, when er einen neuen globalen Bereich erstellt, then kann er den relevanten Vault‑Scope in einer wiederverwendbaren Weise definieren.  
- Given ein oder mehrere globale Bereiche existieren, when der Nutzer sie überprüft, then ist jeder Bereich klar genug dargestellt, um Zweck und Abdeckung zu erkennen.  
- Given der Nutzer ändert oder entfernt einen globalen Bereich, when die Änderung bestätigt wird, then spiegeln sich zukünftige effektive Rechte in dieser aktualisierten Definition wider.

#### 12. API key management interface
**User story**  
Als Nutzer möchte ich API‑Keys in Kado erstellen und verwalten, damit ich verschiedene Agents verbinden kann, ohne den Überblick über deren Zugriff zu verlieren.

**Acceptance criteria**
- Given der Nutzer öffnet das API‑Key‑Management, when er einen Key erstellt, then generiert Kado einen neuen API‑Key und macht ihn zum Kopieren verfügbar.  
- Given ein API‑Key existiert, when der Nutzer die Liste der Keys betrachtet, then kann er jeden Key über seinen sprechenden Namen identifizieren.  
- Given ein API‑Key soll nicht mehr benutzt werden, when der Nutzer ihn deaktiviert oder widerruft, then werden zukünftige Requests mit diesem Key abgelehnt.

#### 13. Per-key configuration screen
**User story**  
Als Nutzer möchte ich für jeden API‑Key eine eigene Konfigurationsansicht haben, damit ich die Berechtigungen eines Agents ohne Verwechslung mit anderen Einstellungen verwalten kann.

**Acceptance criteria**
- Given ein API‑Key existiert, when der Nutzer dessen Konfiguration öffnet, then kann er Scope und Berechtigungen dieses Keys in einem dedizierten Bereich anzeigen und bearbeiten.  
- Given der Nutzer bearbeitet einen API‑Key, when er Änderungen vornimmt, then betreffen diese Änderungen nur diesen Key und keine anderen Keys.  
- Given der Nutzer prüft einen API‑Key, when er die Konfiguration inspiziert, then kann er verstehen, was dieser Key darf.

#### 14. API-key-level area selection inside global bounds
**User story**  
Als Nutzer möchte ich pro API‑Key auswählen können, welche global definierten Bereiche er nutzen darf, damit ich jeden Agenten genau auf seine Arbeitskontexte zuschneiden kann.

**Acceptance criteria**
- Given globale Bereiche existieren, when der Nutzer einen API‑Key konfiguriert, then kann er nur Bereiche zuweisen, die global verfügbar sind.  
- Given ein API‑Key ist konfiguriert, when der Nutzer ihn prüft, then sieht er, welche Teilmenge der globalen Bereiche diesem Key zugewiesen ist.  
- Given ein globaler Bereich wird entfernt oder eingeschränkt, when der Nutzer einen betroffenen API‑Key prüft, then reflektiert die UI, dass sich der effektive Zugriff dieses Keys geändert hat.

#### 15. CRUD permission editing per data type
**User story**  
Als Nutzer möchte ich pro Bereich und API‑Key CRUD‑Rechte separat für Notes, Frontmatter und andere Dateien vergeben, damit ich präzise Agentenprofile erstellen kann, ohne tiefes Technikwissen zu benötigen.

**Acceptance criteria**
- Given der Nutzer konfiguriert einen API‑Key für einen Bereich, when er Berechtigungen bearbeitet, then kann er Rechte für Notes, Frontmatter und andere Dateien unterscheiden.  
- Given Berechtigungen in der UI angezeigt werden, when der Nutzer sie überprüft, then ist klar erkennbar, welche Operationen erlaubt sind und welche nicht.  
- Given der Nutzer Berechtigungen ändert, when die Konfiguration gespeichert wird, then gelten die neuen effektiven Rechte für zukünftige Requests.

#### 16. Understandable effective-permissions view
**User story**  
Als Nutzer möchte ich die effektiven Berechtigungen eines API‑Keys nach Kombination aus globalen und API‑spezifischen Regeln sehen, damit ich prüfen kann, was ein Agent tatsächlich darf.

**Acceptance criteria**
- Given globale und API‑Key‑Einstellungen existieren, when der Nutzer einen API‑Key betrachtet, then kann er die resultierenden effektiven Berechtigungen verstehen, ohne beide Ebenen manuell zusammenrechnen zu müssen.  
- Given ein API‑Key ist restriktiver als die globale Konfiguration, when der Nutzer ihn prüft, then sind die zusätzlichen Einschränkungen sichtbar.  
- Given eine gewünschte Fähigkeit ist nicht effektiv erlaubt, when der Nutzer die Key‑Konfiguration inspiziert, then kann er erkennen, dass diese Fähigkeit blockiert ist.

#### 17. Pfad-/Directory-Listing im erlaubten Scope
**User story**  
Als Nutzer möchte ich, dass ein Agent die strukturierten Inhalte in den für ihn erlaubten Bereichen auflisten kann, damit er überhaupt weiß, welche Notizen und Dateien verfügbar sind.

**Acceptance criteria**
- Given ein API‑Key mit gültigen Rechten, when der Agent ein Listing für einen Pfad anfordert, then gibt Kado nur Einträge zurück, die im globalen und API‑spezifischen Scope liegen.  
- Given ein Listing viele Einträge umfasst, when der Agent Ergebnisse abruft, then liefert Kado sie in klar abgegrenzten Chunks oder Seiten.  
- Given ein Pfad liegt nicht im effektiven Scope, when ein Listing angefordert wird, then lehnt Kado die Anfrage ab.

#### 18. Vollständige, chunked Note-Inhaltssuche
**User story**  
Als Nutzer möchte ich, dass ein Agent nach Text in Notizen suchen kann und vollständige, aber gechunkte Ergebnisse erhält, damit nichts übersehen wird, auch wenn die Suche länger dauert.

**Acceptance criteria**
- Given ein API‑Key mit Leserechten auf Notes, when ein Suchbegriff über Notes im erlaubten Scope gesucht wird, then durchsucht Kado alle relevanten Notes innerhalb dieses Scopes.  
- Given die Anzahl Treffer ist groß, when der Agent Suchresultate abruft, then liefert Kado die Treffer in gechunkt/seitigen Resultsets mit einem Mechanismus zur Nachladung weiterer Treffer.  
- Given ein Bereich ist nicht lesbar, when eine Suche gestellt wird, then erscheinen Inhalte aus diesem Bereich nicht in den Ergebnissen.

#### 19. Frontmatter- und Tag-basierte Suche
**User story**  
Als Nutzer möchte ich, dass ein Agent nach Frontmatter‑Feldern und Tags suchen kann, damit er strukturierte Workflows (z.B. Status‑Felder, Kategorien, Tags) nutzen kann, ohne auf Volltext angewiesen zu sein.

**Acceptance criteria**
- Given ein API‑Key mit Leserechten auf Frontmatter und Notes, when Frontmatter‑ oder Tag‑basierte Filter verwendet werden, then berücksichtigt Kado alle passenden Notes im erlaubten Scope.  
- Given der Agent filtert nach einem Tag oder einfachen Frontmatter‑Feld, when Ergebnisse geliefert werden, then sind sie vollständig bezogen auf den effektiven Scope.  
- Given ein API‑Key hat keine Frontmatter‑Leserechte, when Frontmatter‑spezifische Suchkriterien gestellt werden, then behandelt Kado diese Kriterien so, dass keine unzulässigen Daten offengelegt werden (z.B. Ablehnung oder klar erkennbare Nicht‑Unterstützung).

#### 20. Nutzung von Obsidian-APIs vor eigenen Scans
**User story**  
Als Nutzer möchte ich, dass Kado sich so weit wie möglich auf Obsidian‑APIs und Caches stützt, damit Suche und Listing den Vault‑Zustand effizient und konsistent widerspiegeln.

**Acceptance criteria**
- Given Obsidian‑APIs oder Metadaten‑Caches für eine Art von Suche/Listing existieren, when Kado entsprechende Funktionen anbietet, then nutzt Kado diese Obsidian‑Mechanismen, bevor eigene Vollscans gestartet werden.  
- Given ein Such-/Listing‑Fall nicht vollständig über Obsidian‑APIs abbildbar ist, when Kado eigene Reads einsetzt, then sind diese Reads auf den effektiven Scope und das benötigte Minimum beschränkt.

#### 21. Klare Trennung von Lesen vs. Schreiben in Such-Ergebnissen
**User story**  
Als Nutzer möchte ich, dass Such‑ und Listing‑Funktionen nur das zeigen, was der Agent lesen darf, und keine impliziten Schreibrechte erzeugen, damit ich nicht unbewusst mehr freigebe als geplant.

**Acceptance criteria**
- Given ein API‑Key hat nur Leserechte, when er Such‑ oder Listing‑Funktionen nutzt, then sind alle zurückgegebenen Informationen rein lesend und erlauben keine verdeckten Write‑Operationen.  
- Given ein API‑Key hat Schreibrechte, when er Ergebnisse aus einer Suche nutzt, then werden Schreiboperationen weiterhin gegen die RBAC‑Regeln geprüft und nicht automatisch aus den Suchergebnissen abgeleitet.

### Should Have

- API‑Keys können einen sprechenden Namen für einfachere Administration erhalten.  
- Nutzer können einen API‑Key deaktivieren oder widerrufen, ohne alle anderen Konfigurationen zu löschen.  
- Nutzer können pro API‑Key sehen, welche Bereiche und CRUD‑Rechte aktuell effektiv sind.  
- Nicht autorisierte Antworten machen klar, dass die Aktion durch Berechtigungen blockiert wurde, ohne geschützte Inhalte offenzulegen.  
- Möglichkeit, Suchergebnisse nach Dateityp (Notes vs. andere Dateien) zu filtern, sofern die Berechtigungen dies zulassen.  
- Option, Suchabfragen auf einen bestimmten globalen oder API‑Key‑Bereich zu beschränken, ohne manuell Pfade anzugeben.  
- Einfacher Mechanismus auf Agent‑Seite, um über Cursor/Page‑Token weitere Such‑ oder Listing‑Chunks nachzuladen.  
- Klarer Text und Labels in der UI, die den Unterschied zwischen globaler Konfiguration und API‑Key‑spezifischer Konfiguration erklären.  
- UI‑Wording, das versehentliches Over‑Permissioning (vor allem Delete‑Rechte) reduziert.  
- Einfache Onboarding‑Erklärung, die Default‑Deny und die zwei Ebenen von Berechtigungen verständlich erklärt.  

### Could Have

- Wiederverwendbare Berechtigungsvorlagen für typische Agent‑Rollen.  
- Warnungen, wenn ein Nutzer ungewöhnlich breite Berechtigungen konfiguriert.  
- Plain‑Language‑Zusammenfassung der Berechtigungen eines API‑Keys (z.B. „Darf Notes in /Work lesen, aber nichts löschen“).  
- Guided Setup für einen ersten Agenten (z.B. Tomo).  
- Kombination mehrerer Filter (Tag + Teilpfad + Textfragment) in einer Anfrage, solange Performance kontrollierbar bleibt.  
- Sortierung der Suchergebnisse nach einfachen Kriterien (z.B. Pfadname, Änderungsdatum), sofern über Obsidian verfügbar.  
- „Count only“‑Abfragen, um das Ergebnisvolumen vorab zu sehen.

### Won’t Have (v1)

- Feldgenaue Frontmatter‑Policies oder Tag‑spezifische Rechte unabhängig von Notes/Frontmatter.  
- Persistente globale Suchindizes oder RAG/Vektor‑Suche.  
- Komplexe boolesche Query‑Sprachen oder Regex‑Suche jenseits dessen, was Obsidian nativ anbietet.  
- Automatische Schutzschichten, die indirekte Frontmatter‑Änderungen durch Note‑Writes verhindern.  
- Transport‑Layer‑Security wie vollwertiges TLS/Certificate‑Management.  
- Cross‑Device oder Cross‑Instance‑Permission‑Koordination.  
- Versionierte Konfigurations‑Historie oder multi‑admin‑Collaboration im v1‑Scope.

---

## 5. Detailed Feature Specifications

### 5.1 Permission-Evaluation (effektive Rechte)

**User Flow (high level)**  
1. Ein Agent sendet eine Anfrage mit API‑Key, gewünschter Operation (z.B. Note lesen, Frontmatter updaten) und Ziel (Pfad/Datei).  
2. Kado identifiziert den API‑Key und lädt die zugehörige API‑Config sowie die Global Config.  
3. Kado berechnet aus Global Config und API‑Config die effektiven Rechte für:  
   - den betroffenen Pfad (inkl. zugehörigem Bereich),  
   - den betroffenen Datentyp (Note, Frontmatter, andere Datei),  
   - die angefragte CRUD‑Operation.  
4. Wenn die Operation nicht erlaubt ist, wird sie fail‑fast abgelehnt; ansonsten darf sie in die Ausführung gehen.

**Business Rules**

- **BR‑P1: Existenz eines bekannten API‑Keys**  
  - Anfragen ohne API‑Key oder mit unbekanntem Key gelten als vollständig unautorisiert.  
  - Konsequenz: Anfrage wird sofort abgelehnt; es findet keine weitere Rechteprüfung statt.

- **BR‑P2: Default‑Deny – Global Layer**  
  - Global Config ist immer Default‑Deny (Whitelist mit „nichts erlaubt“).  
  - Ein Pfad kann nur dann in Betracht gezogen werden, wenn er in mindestens einem globalen Bereich liegt, der die angefragte Datentyp‑/CRUD‑Kombination grundsätzlich erlaubt.

- **BR‑P3: API‑Key kann global nur einschränken, nicht erweitern**  
  - API‑Key‑Scopes dürfen niemals Zugriff auf Pfade erlauben, die global nicht erlaubt sind.  
  - Effektive Rechte eines API‑Keys für einen Pfad sind die Schnittmenge aus globalen Rechten und Key‑spezifischen Rechten.

- **BR‑P4: Pfad‑Scoping pro Bereich**  
  - Für jede Anfrage wird der Pfad einem oder mehreren konfigurierten Bereichen zugeordnet (z.B. nach Ordnerstruktur).  
  - Wenn ein Pfad in keinen erlaubten Bereich fällt, sind alle CRUD‑Operationen darauf unzulässig, unabhängig vom Datentyp.

- **BR‑P5: Datentyp‑spezifische Rechte (Note/Frontmatter/andere Dateien)**  
  - Für jeden Bereich werden Rechte getrennt nach Note, Frontmatter und anderen Dateien definiert.  
  - Die effektive Erlaubnis für eine Operation hängt vom Datentyp der Operation ab (z.B. Note‑Read vs. Frontmatter‑Update).

- **BR‑P6: Note‑Operationen umfassen technisch das gesamte Markdown‑Dokument**  
  - Note‑Operationen (lesen, schreiben, löschen) wirken auf das `.md`‑Dokument inklusive embedded Frontmatter.  
  - Wenn Note‑Write erlaubt ist, werden Änderungen am Frontmatter, die durch Note‑Write verursacht werden, als zulässig betrachtet.

- **BR‑P7: Frontmatter‑Operationen sind logisch auf das Frontmatter begrenzt**  
  - Frontmatter‑Operationen greifen ausschließlich den Frontmatter‑Block an, nicht den restlichen Note‑Text.  
  - Frontmatter‑Rechte sind unabhängig von Note‑Rechten, werden bei Note‑Operationen jedoch nicht zusätzlich geprüft.

- **BR‑P8: Andere Dateien folgen eigenem CRUD‑Set**  
  - Rechte für nicht‑Markdown‑Dateien werden separat verwaltet.  
  - Ein Key mit R‑Recht für „andere Dateien“ darf diese lesen, aber ohne C/U/D‑Rechte nicht erstellen, überschreiben oder löschen.

- **BR‑P9: Fail‑Fast‑Entscheidung**  
  - Bevor eine Operation ausgeführt oder in eine Queue gestellt wird, wird die effektive Berechtigung geprüft.  
  - Unzulässige Anfragen werden sofort abgelehnt, mit einer nicht‑leakenden Begründung (z.B. „nicht erlaubt“).

- **BR‑P10: Audit‑Eintrag bei autorisierter und abgelehnter Anfrage (falls aktiviert)**  
  - Ist Audit aktiviert, wird pro Anfrage protokolliert: Key, Operationstyp, Zielbereich/-pfad, Entscheidung (erlaubt/abgelehnt).  
  - Datei‑Inhalte werden nicht ins Log geschrieben.

**Edge Cases**

- **EC‑P1**: Ein Pfad gehört mehreren globalen Bereichen mit unterschiedlichen Rechten → Regeln müssen definieren, wie globale Rechte kombiniert werden (z.B. Vereinigung global, dann Schnittmenge mit Key‑Rechten).  
- **EC‑P2**: Ein globaler Bereich wird geändert/entfernt, während API‑Keys darauf referenzieren → Effektive Rechte richten sich sofort nach der neuen globalen Lage, ohne Altbestand zu privilegieren.

---

### 5.2 Chunked Search & Listing

**User Flow (Search)**  
1. Ein Agent stellt eine Suchanfrage (z.B. Volltext, Tags, Frontmatter‑Filter) innerhalb seines erlaubten Scopes.  
2. Kado prüft die Berechtigungen (Leserechte, Scope).  
3. Kado führt die Suche über den erlaubten Scope aus und sammelt alle passenden Treffer.  
4. Kado liefert die Ergebnisse in Chunks/Seiten mit Möglichkeit zur Nachladung weiterer Chunks.

**Business Rules**

- **BR‑S1: Scope‑First‑Search**  
  - Vor jeder Suche wird der effektive Scope des API‑Keys berechnet.  
  - Nur Dateien/Notes im effektiven Scope werden in die Suchmenge aufgenommen.

- **BR‑S2: Obsidian‑API‑First‑Strategie**  
  - Listing/Suche nutzt, wo möglich, Obsidian‑APIs/Metadaten‑Caches.  
  - Eigene Datei‑Reads kommen nur dort zum Einsatz, wo Obsidian nicht ausreicht, und werden auf den Scope beschränkt.

- **BR‑S3: Vollständigkeit vor Geschwindigkeit**  
  - Eine Suche gilt als erfolgreich, wenn alle relevanten Dateien im Scope geprüft wurden.  
  - Langsamkeit ist akzeptabel; Performance wird über Chunking/Throttling gesteuert, nicht durch vorzeitigen Abbruch.

- **BR‑S4: Chunking von Ergebnissen**  
  - Überschreitet die Trefferzahl eine Schwelle, werden Ergebnisse in mehreren Chunks bereitgestellt.  
  - Jeder Chunk enthält genügend Informationen für sinnvolle Weiterarbeit des Agents.

- **BR‑S5: Cursor/„Next Page“-Mechanismus**  
  - Jeder Chunk enthält Metadaten für das gezielte Nachladen des nächsten Chunks (z.B. Cursor/Token).  
  - Wenn keine weiteren Ergebnisse vorhanden sind, signalisiert Kado dies klar.

- **BR‑S6: Trennung von Datentypen in der Suche**  
  - Spezifische Note‑Suchen schließen andere Dateien aus, und umgekehrt, außer der Agent fordert gemischte Typen explizit an.  
  - Frontmatter‑Filter betreffen Notes; Frontmatter‑Leserechte beeinflussen, welche Metadaten in Resulten sichtbar sind.

- **BR‑S7: Keine implizite Erweiterung von Rechten durch Suche**  
  - Suche/Listing dürfen keine Informationen über Pfade/Bereiche preisgeben, für die der API‑Key keine Leserechte hat.  
  - Treffer aus nicht lesbaren Bereichen werden vollständig unterdrückt.

- **BR‑S8: Fehler-/Timeout‑Handhabung**  
  - Bricht eine Suche durch Laufzeitlimit oder Fehler ab, informiert Kado den Agent, dass Ergebnisse unvollständig sind.  
  - Kado deklariert teilweise Ergebnisse nicht als vollständig, wenn Teile des Scopes nicht durchsucht wurden.

**Edge Cases**

- **EC‑S1**: Sehr große Trefferlisten in einem Bereich → Chunk‑Größen müssen Obsidian responsiv halten und trotzdem vollständige Nachladbarkeit gewährleisten.  
- **EC‑S2**: Vault‑Änderungen während mehrstufiger Such‑/Listing‑Sequenzen → Kado garantiert keine historische Konsistenz, arbeitet auf aktuellem Stand, signalisiert aber keine falsche Vollständigkeit.

---

## 6. Success Metrics

**Security & Correctness**

1. Anteil blockierter unautorisierter Requests  
   - Ziel: ≥ 99 % aller Requests, die außerhalb des effektiven Scopes liegen, werden korrekt abgelehnt.  
   - Messung: Verhältnis „abgelehnte Requests wegen Permissions“ zu „alle Requests mit ungültigen Pfaden/Operationen“ (Audit/Logs, falls vorhanden).

2. Null Incidents mit Datenverlust durch Kado  
   - Ziel: 0 bestätigte Fälle, in denen Kado v1 zu unerwünschtem Löschen/Überschreiben außerhalb der erlaubten Rechte geführt hat.  
   - Messung: Incident‑Tracking (Issues/Support), Klassifizierung nach Ursache.

3. Korrekte Scope‑Einhaltung bei Suche/Listing  
   - Ziel: 100 % der Such‑/Listing‑Ergebnisse enthalten nur Einträge im effektiven Scope des API‑Keys.  
   - Messung: Stichtags‑Tests mit Test‑Vaults, Vergleich erwartete vs. gelieferte Treffer.

**Usability & Configuration**

4. Zeit bis zum ersten erfolgreich konfigurierten Agent  
   - Ziel: Median < 15 Minuten vom Plugin‑Install bis zum ersten erfolgreichen Agent‑Call auf gewünschte Bereiche.  
   - Messung: User‑Tests oder Telemetrie‑Proxies (Zeit zwischen „Settings geöffnet“ und „erstem erlaubten Request eines neuen Keys“).

5. Konfigurationsfehlerquote pro API‑Key  
   - Ziel: < 10 % der API‑Keys werden so konfiguriert, dass Nutzer später melden, „Agent sieht zu viel oder zu wenig“.  
   - Messung: Support/Issue‑Auswertung, ggf. Telemetrie zu wiederholten Permission‑Fehlern.

6. Klarheit der effektiven Rechte  
   - Ziel: ≥ 80 % der befragten Nutzer sagen, dass sie anhand der UI verstehen, was ein API‑Key darf.  
   - Messung: Kurze Befragung/Beta‑Feedback (Likert‑Skala).

**Adoption & Engagement**

7. Anzahl aktiver Installationen mit mind. einem genutzten API‑Key  
   - Ziel: Konkreter Zielwert X innerhalb Y Monaten (zu definieren).  
   - Messung: Anonyme Install/Usage‑Signale, falls zulässig; sonst Proxy‑Metriken (Downloads, Issues).

8. Nutzung mehrerer API‑Keys pro Installation  
   - Ziel: ≥ 30 % der aktiven Installationen verwenden mehr als einen API‑Key.  
   - Messung: Aggregierte Zählung konfigurierter Keys (wenn technisch/privatsphärenkonform möglich).

---

## 7. Constraints and Assumptions

**Technical Constraints**

1. Obsidian‑Plugin‑Modell  
   - Kado v1 läuft ausschließlich als Obsidian‑Plugin.  
   - Alle Funktionen müssen mit den verfügbaren Obsidian‑APIs und einem lokalen Vault funktionieren.

2. MCP‑Server im Plugin  
   - Kado stellt selbst den MCP‑Server bereit und läuft auf der Maschine des Nutzers.  
   - Keine zusätzliche externe Infrastruktur wird vorausgesetzt.

3. Kein persistenter Index in v1  
   - Kado v1 verwendet keinen dauerhaften On‑Disk‑Index.  
   - Suche/Listing: Obsidian‑API‑first, on‑demand Reads mit Chunking.

4. Netzwerk/Transport  
   - v1 unterstützt Bindung an localhost oder eine konfigurierte IP, aber keine vollständige TLS‑/Zertifikats‑Infrastruktur.  
   - Absicherung des Transports zwischen Geräten liegt beim Nutzer.

5. Keine Multi‑Instance‑Koordination  
   - Kado v1 koordiniert keinen Zustand zwischen mehreren Obsidian‑Instanzen.  
   - Obsidian Sync/andere Syncs sind separate Schichten.

**Product & Scope Constraints**

6. Security‑Fokus mit einfacher Modellierung  
   - RBAC: Pfad‑Scopes + CRUD pro Datentyp.  
   - Feldgenaue Frontmatter‑Policies/Tag‑spezifische Rechte sind out of scope.

7. Keine Anti-Corruption-Schicht auf Note-Ebene  
   - Indirekte Frontmatter‑Änderungen über Note‑Write sind akzeptiert, sofern Note‑Write erlaubt ist.  
   - Kado blockiert diese Wege auch später bewusst nicht.

8. Kein RAG/Vektor in v1  
   - RAG/Vektor‑Suche und semantische Indizes sind bewusst ausgeschlossen und als zukünftiges, eigenes Plugin/Feature gedacht.

**Assumptions**

9. Nutzertechnische Kompetenz  
   - Zielnutzer können Plugins installieren, API‑Keys in Clients konfigurieren und Pfad/Ordner‑Konzepte verstehen.

10. AI-Clients unterstützen MCP stabil  
   - Wichtige Ziel‑Clients (z.B. Tomo) unterstützen MCP ausreichend stabil, um Kado als lokalen Server zu nutzen.  
   - Client‑Limitierungen sind kein primärer Scope von Kado v1.

11. Vault‑Größen im „vernünftigen“ Rahmen  
   - Annahme: typische Vaults sind groß, aber nicht extrem (keine Millionen Dateien als Primärziel).  
   - Korrektheit + akzeptable Performance für Knowledge‑Worker‑Vaults sind Fokus.

12. Telemetrie/Privacy  
   - Annahme: keine Inhalts‑Telemetrie; falls Metriken, dann ohne Inhalte und idealerweise opt‑in.  
   - PRD fordert keine konkrete Telemetrie‑Implementierung, nur mögliche KPIs.

---

## 8. Open Questions

1. Audit-Detailgrad und Aufbewahrung  
   - Wie detailliert sollen Audit‑Logs in v1 sein (nur Entscheidung + Pfad/Bereich + Operationstyp vs. zusätzliche Metadaten)?  
   - Welche Aufbewahrungsdauer ist sinnvoll und braucht es UI‑Unterstützung für Löschen/Rotation?

2. UX-Tiefe für effektive Rechte  
   - Wie visuell soll der Rechte‑Überblick sein (Tabelle vs. grafischer Scope‑View)?  
   - Braucht v1 eine „Explain in plain language“‑Ansicht je API‑Key?

3. Konfiguration von Chunk-Größen  
   - Sollen Chunk‑Größen fest verdrahtet oder konfigurierbar sein (ggf. in Advanced‑Settings)?  
   - Ist ein „Schonmodus“ für schwächere Maschinen in v1 nötig?

4. Umgang mit sehr großen Vaults  
   - Braucht v1 Warnungen/Hinweise für extrem große Vaults?  
   - Ist ein „Scope‑Health‑Check“ sinnvoll, der potentielle Performance‑Probleme durch Konfiguration + Vault‑Größe transparent macht?

5. Minimaler Audit-/Telemetry-Funktionsumfang  
   - Welche minimalen Signale braucht das Team, um Sicherheit und Nutzbarkeit zu beurteilen, ohne Inhalte zu sammeln?  
   - Soll es in v1 überhaupt eine optionale Telemetrie geben, oder bleibt alles strikt lokal/offline?

6. Interaktion mit zukünftigen Index/RAG-Plugins  
   - Wie stark soll Kado v1 bereits auf spätere Index/RAG‑Plugins vorbereitet sein (abstrahiertes Search‑Interface vs. direkte Obsidian‑Calls)?  
   - Soll ein expliziter Extension‑Point definiert werden oder wird dies in SDD/RFCs nachgelagert?

---

## Validation Checklist

**Critical gates**

- [x] Alle acht Sektionen sind ausgefüllt.  
- [x] Keine [NEEDS CLARIFICATION]‑Marker verbleiben.  
- [x] Problem Statement ist spezifisch und begründet (AI‑Zugriff auf Vaults ohne Kontrolle, Workarounds, Sicherheitsbedenken).  
- [x] Alle Must‑Have Features haben testbare Acceptance Criteria in Given/When/Then‑Form.  
- [x] Keine offensichtlichen Widersprüche zwischen Sektionen (Scope/Non‑Goals, Constraints, Business Rules konsistent).  

**Quality checks**

- [x] Problem ist durch reale Nutzungsszenarien und bestehende Limitierungen motiviert, nicht nur Annahmen.  
- [x] Primärpersona (Knowledge Worker) hat mindestens eine User Journey.  
- [x] Alle MoSCoW‑Kategorien (Must/Should/Could/Won’t) sind abgedeckt.  
- [x] Keine technischen Implementierungsdetails (Code, DB‑Schema, API‑Specs) im PRD – diese bleiben dem SDD vorbehalten.  
- [x] Ein neues Teammitglied kann auf Basis dieses PRD verstehen, was Kado v1 leisten soll und warum.

