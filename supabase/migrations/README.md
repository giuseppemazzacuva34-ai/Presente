# Migrazioni del database

Una migrazione per issue (prima: #2, profilo, voce, foto nascoste e questionario), con nome
`AAAAMMGGhhmmss_descrizione.sql`. Ogni tabella con dati delle persone nasce con le regole per riga
(RLS) attive. Si applicano dal workflow su `main`, mai a mano e mai con dati reali nel repository.
