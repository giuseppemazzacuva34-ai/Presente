# Contatti del modulo Meta in lista d'attesa, senza AI (D85 = A)

Versione 1.0 · 2 novembre 2026 · autore: CTO («sviluppatore») · compito T43 del piano operativo.

## In parole semplici

Fino al 1° novembre i contatti del modulo dentro Facebook e Instagram arrivavano in lista passando ogni ora da Claude
(automazione «Contatori»). Con la D85 = A questo passaggio è stato tolto: nessuna AI deve vedere quei contatti.

Adesso il percorso è diretto: **Meta → il nostro sito su Cloudflare → la lista D1**. Quando qualcuno compila il modulo,
Meta avvisa il nostro indirizzo `https://presenteincontri.app/meta/webhook` (lo stesso già pronto per i commenti «BUIO»)
e il sito, in pochi secondi, chiede a Meta email e risposte di quel contatto e lo mette in lista.
Nessun servizio in mezzo (né Claude, né Make, né Composio). Costo: zero.

Regole uguali all'import a mano dal CSV (`scripts/importa_meta.mjs`), scritte una volta sola in `worker/contatti_meta.js`:

- si aggiungono solo email nuove: chi è già in lista (anche dal sito) non cambia;
- solo chi ha confermato i 18 anni;
- i contatti di prova di Meta vengono scartati;
- si salvano solo email, zona (città), «mi presento come» se c'è, il codice della presentatrice se c'è (D88, docs/codici-presentatrici.md), data d'invio del modulo, versione dell'informativa, `sorgente = meta_modulo`;
- nei log e in `/conteggio` solo numeri (`esiti_iscrizione`: `meta_nuova`, `meta_gia_in_lista`, `meta_scartata`, `meta_errore`).

Restano a mano, come oggi: cancellare i contatti dal Centro contatti di Meta entro 7 giorni (informativa, punto 3).

## Interruttori (`wrangler.jsonc`)

| Variabile | Oggi | Significato |
| --- | --- | --- |
| `IMPORT_META` | `no` | `si` = il sito legge e salva i contatti nuovi. Si accende dopo la prova descritta sotto. |
| `META_MAGGIORENNE_NEL_MODULO` | `no` | `si` solo se nel modulo i 18 anni sono una dichiarazione obbligatoria senza domanda; con la domanda «Hai almeno 18 anni?» resta `no`. |

## Cosa deve fare Giuseppe su Meta (una volta sola, circa 15 minuti)

I segreti si scrivono **solo** su Cloudflare (Workers → `presente` → Impostazioni → Variabili e segreti → «Segreto»),
mai in chat, in plancia o nel repository. Se l'app Meta per i commenti «BUIO» (docs/meta-webhook.md) esiste già, si usa la stessa.

1. **App Meta** (developers.facebook.com): se non c'è, «Crea app» → tipo «Business», collegata al Business Manager di Presente; prodotto «Webhooks».
2. **Permessi del token della Pagina**: genera un token della Pagina a lunga durata con `leads_retrieval`, `pages_manage_ads`,
   `pages_manage_metadata`, `pages_read_engagement`, `pages_show_list`. In modalità sviluppo basta che tu sia amministratore dell'app e della Pagina.
3. **Accesso ai contatti**: Business Manager → Impostazioni → Integrazioni → «Accesso ai contatti» → scegli la Pagina → assegna l'app.
4. **Segreti su Cloudflare**: `META_APP_SECRET` (chiave segreta dell'app), `META_VERIFY_TOKEN` (una parola lunga inventata), `META_PAGE_TOKEN` (il token del passo 2).
5. **Webhook**: in «Webhooks» → «Page» inserisci `https://presenteincontri.app/meta/webhook` e la stessa parola di `META_VERIFY_TOKEN`; spunta il campo **`leadgen`**. Poi abbona la Pagina all'app (`leadgen`).
6. Scrivi al CTO in plancia «Meta contatti pronta» (senza segreti).

Poi il CTO: manda un contatto con lo strumento di prova di Meta (Lead Ads Testing Tool, scartato perché «di prova»), controlla in `/conteggio`
che compaia `meta_scartata`, mette `IMPORT_META` a `si` e verifica il primo contatto vero (`meta_nuova`).

## Come funziona (tecnica)

- Codice: `worker/meta.js` (`contattiModulo`, `importaContatto`), regole in `worker/contatti_meta.js`; test in `test/meta.test.mjs` e `test/importa_meta.test.mjs`.
- Ogni chiamata di Meta è firmata (`X-Hub-Signature-256` con `META_APP_SECRET`): senza firma giusta non si legge e non si salva nulla.
- Si accettano solo notifiche `object = page`, campo `leadgen`, della nostra Pagina (`META_PAGE_ID`), con id numerico; al massimo 25 per chiamata.
- Lettura: `GET /{versione}/{id contatto}?fields=created_time,field_data` con il token della Pagina; scrittura: `INSERT … ON CONFLICT(email) DO NOTHING` con parametri.
- Il Worker risponde subito 200 a Meta e lavora in sottofondo; un contatto già salvato, se Meta ripete l'avviso, dà `meta_gia_in_lista`.
- Quando arriverà la provincia (D84, insieme all'informativa 1.4) la stessa funzione leggerà anche la domanda sulla provincia.

## Privacy

Meta resta la piattaforma dove la persona compila il modulo; Cloudflare (già nostro fornitore per sito e lista) riceve e salva.
Non si aggiunge nessun fornitore. Nell'informativa 1.4 (CFO) il punto 8 toglie Composio e Anthropic dal passaggio dei contatti.
