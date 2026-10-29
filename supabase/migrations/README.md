# Migrazioni del database

Una migrazione per issue (prima: #2, profilo, voce, foto nascoste e questionario), con nome
`AAAAMMGGhhmmss_descrizione.sql`. Ogni tabella con dati delle persone nasce con le regole per riga
(RLS) attive. Si applicano dal workflow su `main`, mai a mano e mai con dati reali nel repository.

Prova in locale e in «Verifica»: `bash scripts/test_supabase.sh` crea un Postgres temporaneo, ricrea il minimo di
Supabase (`supabase/test/supabase_finto.sql`), applica tutte le migrazioni e lancia i test delle regole per riga
(`supabase/test/regole_per_riga.sql`: con due account di prova, B non legge né modifica nulla di A).

| Migrazione | Issue | Cosa crea |
|---|---|---|
| `20261029140000_profilo.sql` | #2 | `profili` (solo maggiorenni, data di nascita non modificabile), `filtri` («cerco» solo con consenso, data e versione dell'informativa), `questionario` (una versione per settimana, vale dal lunedì alle 9:00 di Roma), cartelle private `voci` e `foto` (ognuno solo nella sua cartella) |
