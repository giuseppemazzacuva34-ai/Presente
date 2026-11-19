// Prova finta dell'app (D141 A, linea «sviluppatore-c»): le schermate vere di flusso.js con il «server finto» di
// prova.js al posto del database e del Worker. Niente rete, niente salvataggi sul telefono: ricaricando la pagina
// si ricomincia da capo. Pagina non linkata e non indicizzata: /app/prova.html.
import { avvia } from "/app/moduli/flusso.js";
import { creaProva } from "/app/moduli/prova.js";

avvia(document.getElementById("app"), creaProva());
