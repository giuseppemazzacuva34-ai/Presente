# Salvare video e immagini nel ramo media-social

Dal 9/11 (richiesta del coordinatore). Gli strumenti GitHub degli agenti scrivono solo testo, quindi i file binari
(mp4, webm, jpg, png) si salvano con il workflow **«Salva media»** (`.github/workflows/salva-media.yml`).

## Come si usa

1. Avvia il workflow «Salva media» sul ramo `main` (GitHub › Actions › Salva media › Run workflow, oppure con lo
   strumento GitHub `actions_run_trigger`, metodo `run_workflow`, `workflow_id` = `salva-media.yml`, `ref` = `main`).
2. Dai due dati:
   - `link`: link **https pubblico** che scarica direttamente il file (download di Canva, Drive con
     `uc?export=download&id=…`, un altro file su GitHub). Non una pagina di anteprima.
   - `nome_file`: nome nel ramo, minuscole, cifre, `-` e `_`, al massimo una sottocartella, estensione
     `.mp4`, `.webm`, `.jpg`/`.jpeg` o `.png`. Esempio: `tiktok/vera-conto-v3.mp4`.
3. Dopo circa un minuto, nel riepilogo dell'esecuzione c'è la riga
   `file_pubblico_github: https://raw.githubusercontent.com/giuseppemazzacuva34-ai/presente/media-social/<nome_file>`.
   Il link è sempre questo, quindi si può scrivere subito in plancia e controllare che l'esecuzione sia verde.

## Controlli (in `scripts/salva_media.mjs`, test in `test/salva_media.test.mjs`)

- Solo link https verso indirizzi pubblici, senza credenziali nel link; il link di origine non compare nel log.
- Al massimo 95 MB (GitHub rifiuta i file oltre 100 MB).
- Il contenuto deve essere davvero del tipo dell'estensione: se il link porta a una pagina web l'esecuzione fallisce.
- Mai sovrascrivere: se il nome esiste già fallisce. Usa un nome nuovo (`-v2`, `-v3`).
- Scrive solo nel ramo `media-social`, mai su `main`. Nessun costo (repository pubblico) e nessun segreto.

Il ramo è pubblico: niente volti o voci di persone senza consenso scritto, niente dati personali nei file.
