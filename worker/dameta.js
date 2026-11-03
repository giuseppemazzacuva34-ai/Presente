// PAGINA /da/meta (D92 A + testi D82 A, 2/11): è l'indirizzo del pulsante «Vai al sito» nella schermata finale del modulo
// Meta v1. Chi arriva qui si è appena iscritto dal modulo: niente secondo modulo, ma «Sei in lista!», la frase approvata
// in D82 e il pulsante «Segui @presente_app». Sotto, piccolo, il link per chi non è ancora iscritto.
// Conteggi (solo totali in visite_pagina, nessun dato personale): righe «da-meta» (visita), «da-meta-persona» (immagine 1×1)
// e «segui_ig» (clic sul pulsante, via /segui?da=meta). La visita conta anche nel canale «meta» come prima (visite_canale).
// Dal 2/11 (CRO, deciso da Giuseppe) sotto Instagram c'è il blocco «porta un'amica» uguale a /grazie: link /da/amico
// (conteggio del canale «amico»), senza codice personale perché qui non sappiamo chi si è iscritto.
export const PERCORSO_DA_META = "/da/meta";

const HTML = `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sei in lista · Presente</title>
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="#0e0d10">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/stile.css?v=20261102a">
</head>
<body>
  <div class="pagina">
    <header class="testata">
      <a class="logo" href="/" aria-label="Presente, pagina iniziale">
        <span>presente</span>
        <svg viewBox="0 0 14 32" aria-hidden="true"><g transform="rotate(10 7 16)" fill="#e8432b"><rect x="4" y="1" width="6" height="20" rx="3"/><circle cx="7" cy="27" r="3.4"/></g></svg>
      </a>
    </header>
    <main>
      <h1>Sei in lista!</h1>
      <section class="segui-ig" aria-labelledby="segui-ig">
        <p id="segui-ig" class="attacco">Le città e i primi posti li annunciamo prima su Instagram.</p>
        <p><a class="bottone" href="/segui?da=meta" rel="noopener">Segui @presente_app</a></p>
      </section>
      <section class="invita">
        <h2>Porta un'amica o un amico. <em>La tua città si accende prima.</em></h2>
        <p>Si parte con la Stanza Italia. Le stanze della tua città aprono quando arriva a 36 iscritti: ogni persona che porti la avvicina. Pensa a un'amica stanca delle solite app: mandale Presente e chiedile di scrivere il tuo nome nel campo «Chi ti ha invitato?». Vale anche per un amico.</p>
        <p><a class="bottone" href="https://wa.me/?text=Ti%20giro%20questa%3A%20un%27app%20di%20incontri%20al%20buio%20dove%20nessuno%20vede%20le%20tue%20foto%20finch%C3%A9%20non%20vi%20scegliete%20in%20due.%20Prima%20ci%20si%20parla%20a%20voce%2C%20poi%20si%20decide%20se%20vedersi.%20La%20nostra%20citt%C3%A0%20apre%20quando%20arriva%20a%2036%20iscritti%3A%20entra%20in%20lista%20%28%C3%A8%20gratis%29%20e%20scrivi%20il%20mio%20nome%20come%20invito%20%F0%9F%91%89%20https%3A%2F%2Fpresenteincontri.app%2Fda%2Famico" rel="noopener">Mandalo a un'amica su WhatsApp</a></p>
        <p><a class="bottone bottone-chiaro" href="https://t.me/share/url?url=https%3A%2F%2Fpresenteincontri.app%2Fda%2Famico&amp;text=Ti%20giro%20questa%3A%20un%27app%20di%20incontri%20al%20buio%20dove%20nessuno%20vede%20le%20tue%20foto%20finch%C3%A9%20non%20vi%20scegliete%20in%20due.%20Prima%20ci%20si%20parla%20a%20voce%2C%20poi%20si%20decide%20se%20vedersi.%20La%20nostra%20citt%C3%A0%20apre%20quando%20arriva%20a%2036%20iscritti%3A%20entra%20in%20lista%20%28%C3%A8%20gratis%29%20e%20scrivi%20il%20mio%20nome%20come%20invito" rel="noopener">Invia su Telegram</a></p>
      </section>
      <p class="nota">Non ti sei ancora iscritto? <a href="/?da=meta#iscriviti">Iscriviti gratis alla lista d'attesa</a></p>
    </main>
    <footer class="piede">
      <p><a href="/privacy">Informativa privacy</a></p>
    </footer>
  </div>
  <img class="px" src="/p.gif?pg=da-meta" alt="" width="1" height="1" aria-hidden="true">
</body>
</html>`;

export function paginaDaMeta(request) {
  return new Response(request.method === "HEAD" ? null : HTML, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, max-age=0", "x-robots-tag": "noindex" },
  });
}
