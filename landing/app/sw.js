// Service worker della web app (Fase 2, issue #1).
// Rende l'app installabile e tiene in memoria solo i file pubblici dell'app (mai risposte con dati personali):
// se la rete manca, mostra l'ultima versione salvata della pagina.
const VERSIONE = "presente-app-41";
const FILE = ["/app/", "/app/app.css", "/app/avvio.js", "/app/moduli/flusso.js", "/app/moduli/domande.js", "/app/moduli/registratore.js",
  "/app/moduli/foto.js", "/app/moduli/accesso.js", "/app/moduli/salvataggio.js", "/app/moduli/province.js", "/app/moduli/lista.js", "/app/moduli/aree.js", "/app/moduli/zona.js", "/app/moduli/stanza.js", "/app/moduli/chiamata.js", "/app/moduli/voce.js", "/app/moduli/compagni.js", "/app/moduli/sentinella.js", "/app/moduli/telefono.js", "/app/manifest.webmanifest", "/stile.css", "/favicon.svg",
  "/app/moduli/segnala.js", "/app/moduli/disponibilita.js", "/app/moduli/diario.js",
  "/app/moduli/difficolta.js", "/app/moduli/blocca.js",
  "/app/moduli/chiavi.js", "/app/moduli/chiavi_stanza.js",
  "/app/moduli/storico_chiamate.js",
  "/app/moduli/esiti_segnalazioni.js",
  "/app/moduli/sanzioni.js",
  "/app/moduli/appunti_stanza.js",
  "/app/moduli/aiuto.js",
  "/app/moduli/svelamento.js",
  "/app/moduli/in_attesa.js",
  "/app/moduli/avvisi_porte.js",
  "/app/moduli/sala_attesa.js",
  "/app/moduli/schermata_svelamento.js",
  "/app/moduli/video_svelamento.js",
  "/app/moduli/regole_community.js",
  "/app/moduli/incontro.js", "/app/moduli/valutazione.js", "/app/moduli/vostri_incontri.js",
  "/app/moduli/settimana_home.js"];

self.addEventListener("install", (evento) => {
  evento.waitUntil(caches.open(VERSIONE).then((cache) => cache.addAll(FILE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nomi) => Promise.all(nomi.filter((nome) => nome !== VERSIONE).map((nome) => caches.delete(nome))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (evento) => {
  const richiesta = evento.request;
  const url = new URL(richiesta.url);
  // Solo GET dello stesso sito e dei file elencati: tutto il resto (in futuro Supabase, chiamate) va sempre in rete.
  if (richiesta.method !== "GET" || url.origin !== self.location.origin || !FILE.includes(url.pathname)) return;
  // Prima la rete (così si vede sempre la versione nuova), la copia salvata solo se la rete manca.
  evento.respondWith(
    fetch(richiesta)
      .then((risposta) => {
        if (risposta.ok) {
          const copia = risposta.clone();
          caches.open(VERSIONE).then((cache) => cache.put(richiesta, copia));
        }
        return risposta;
      })
      .catch(() => caches.match(richiesta)),
  );
});
