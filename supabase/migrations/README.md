# Migrazioni del database

Una migrazione per issue (prima: #2, profilo, voce, foto nascoste e questionario), con nome
`AAAAMMGGhhmmss_descrizione.sql`. Ogni tabella con dati delle persone nasce con le regole per riga
(RLS) attive. Si applicano dal workflow «Database» (`.github/workflows/database.yml`, script `scripts/applica_migrazioni.sh`) su `main`, mai a mano e mai con dati reali nel repository. Il registro delle migrazioni applicate è `supabase_migrations.schema_migrations`, lo stesso della CLI di Supabase.

Prova in locale e in «Verifica»: `bash scripts/test_supabase.sh` crea un Postgres temporaneo, ricrea il minimo di
Supabase (`supabase/test/supabase_finto.sql`), applica tutte le migrazioni e lancia i test delle regole per riga
(`supabase/test/regole_per_riga.sql`: con due account di prova, B non legge né modifica nulla di A).

| Migrazione | Issue | Cosa crea |
|---|---|---|
| `20261029140000_profilo.sql` | #2 | `profili` (solo maggiorenni, data di nascita non modificabile), `filtri` («cerco» solo con consenso, data e versione dell'informativa), `questionario` (una versione per settimana, vale dal lunedì alle 9:00 di Roma), cartelle private `voci` e `foto` (ognuno solo nella sua cartella) |
| `20261029234100_limiti_sicurezza.sql` | #2 | tetto di grandezza al questionario, `search_path` fisso nelle funzioni (revisione CISO) |
| `20261030220000_consenso_dal_server.sql` | #2 | la data del consenso a «cerco» la scrive il server (requisito 3 del CISO) |
| `20261030230000_limiti_file_elimina.sql` | #2 | al massimo 4 voci e 3 foto a persona: nelle cartelle si scrivono solo i nomi fissi `presentazione`, `risposta-1…3`, `foto-1…3` (requisito 4 del CISO) |
| `20261030231000_domande_voce.sql` | #2 | `profili.domande_voce`: le 3 domande a voce scelte (solo numeri da 0 a 7, senza doppioni) |
| `20261031000000_regole_dal_server.sql` | #2 | la data di accettazione delle regole la scrive il server e non si cambia più (revisione CISO) |
| `20261102220000_stanze.sql` | #3 | `stanze` e `membri_stanza`: le crea solo il lavoro del lunedì; ognuno vede solo la sua stanza; nessuno entra senza data di nascita (requisito 2 del CISO), massimo 12 a stanza, una stanza alla volta; `compagni_di_stanza()` dà dei compagni solo nome, età e città |
| `20261107220000_aree.sql` | #3 | aree vaste (D121 A): `aree` e `province.area` (ogni provincia in una sola area, uguale a `api/aree.js`); «Solo la mia zona» confronta le aree; `conteggi_aree()` solo numeri, solo per il server |
| `20261113220000_richiameresti.sql` | #4 | `richiameresti`: «La richiameresti?» (sì / no / salta) solo per il server, una risposta per chiamata, riproposta una volta al rientro; `pulisci_stanze_chiuse()` cancella carte viste e risposte delle stanze chiuse (la chiama il lavoro del lunedì) |
| `20261113145000_segnalazioni.sql` | #7 | `segnalazioni` solo per il server (motivo, punto di partenza, racconto facoltativo, scadenza della revisione 1/24/72 ore); `nuova_segnalazione()` salva la segnalazione e, se serve, il blocco nella stessa transazione («Chiudi e segnala» blocca sempre); le segnalazioni restano se una delle due persone elimina l'account. Test in `supabase/test/prova_segnalazioni.sql` |
