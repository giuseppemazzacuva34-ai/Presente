// Service worker della web app (Fase 2, issue #1).
// Rende l'app installabile e tiene in memoria solo i file pubblici dell'app (mai risposte con dati personali):
// se la rete manca, mostra l'ultima versione salvata della pagina.
const VERSIONE = "presente-app-2";
const FILE = ["/app/", "/app/app.css", "/app/avvio.js", "/app/moduli/flusso.js", "/app/moduli/domande.js", "/app/moduli/registratore.js",
  "/app/moduli/foto.js", "/app/manifest.webmanifest", "/stile.css", "/favicon.svg"];

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
