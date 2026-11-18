// Sala d'attesa dello svelamento (issue #65, passo 6b; spec v1 del CPO, passo 5, passo 7 e casi limite sulla
// fotocamera; D48 A). Linea del CTO.
// Prima di entrare: avviso da confermare («Ho capito»), poi l'anteprima della propria fotocamera, solo frontale,
// sfocata, senza microfono e senza pulsante per cambiare fotocamera. L'immagine resta nel telefono: niente invii,
// niente salvataggi, niente foto. Il «tipo» (video o foto) lo dà il server solo nel momento dello svelamento (passo 6a):
// con le foto, o con un tipo sconosciuto, la fotocamera non si accende mai. Fotocamera negata o assente:
// «Non vediamo la tua fotocamera.» con «Riprova» e «Passa alle foto» (vale per entrambi, lo decide il server).
// Il modulo non tocca la pagina: getUserMedia, lo schermo (<video>) e «passa alle foto» arrivano da fuori, così si
// prova con node --test.

export const TESTI_SALA = Object.freeze({
  // Testo della spec (passo 5).
  avviso: "Lo svelamento non viene registrato. Non fare screenshot: sul video compare il tuo nome. Rispetta le regole della community.",
  foto: "Lo svelamento sarà con le foto.",
  senzaFotocamera: "Non vediamo la tua fotocamera.",
  riprova: "Riprova",
  passaFoto: "Passa alle foto",
  // Provvisori, da rivedere con «contenuti».
  titolo: "Sala d'attesa",
  vai: "Vai alla sala d'attesa",
  capito: "Ho capito",
  anteprima: "La tua fotocamera, sfocata. La vedi solo tu.",
  attendi: "Un attimo…",
});

// Solo la fotocamera frontale e solo il video: in sala d'attesa il microfono non serve.
export const VINCOLI_SALA = Object.freeze({ audio: false, video: Object.freeze({ facingMode: "user" }) });

const ferma = (flusso) => {
  try { for (const t of flusso.getTracks()) t.stop(); } catch { /* già fermo */ }
};

export function creaSalaAttesa({ getUserMedia, schermo = null, passaAlleFoto = async () => ({ ok: false }), aggiorna = () => {} } = {}) {
  let stato = "chiusa"; // chiusa | avviso | attesa_fotocamera | anteprima | senza_fotocamera | foto
  let flusso = null;
  let giro = 0; // cambia a ogni apertura/chiusura: una fotocamera arrivata tardi si ferma subito
  let errore = null;
  let inCorso = false;
  const avvisa = () => { try { aggiorna(); } catch { /* la vista non deve fermare la sala */ } };

  function spegni() {
    if (flusso) ferma(flusso);
    flusso = null;
    if (schermo) schermo.srcObject = null;
  }

  async function accendi() {
    const mio = ++giro;
    errore = null;
    if (typeof getUserMedia !== "function") {
      stato = "senza_fotocamera";
      avvisa();
      return;
    }
    stato = "attesa_fotocamera";
    avvisa();
    let f;
    try {
      f = await getUserMedia(VINCOLI_SALA);
    } catch {
      if (mio !== giro) return;
      stato = "senza_fotocamera";
      avvisa();
      return;
    }
    if (mio !== giro || stato !== "attesa_fotocamera") {
      ferma(f);
      return;
    }
    try { for (const t of f.getAudioTracks ? f.getAudioTracks() : []) t.stop(); } catch { /* niente audio */ }
    flusso = f;
    if (schermo) schermo.srcObject = f;
    stato = "anteprima";
    avvisa();
  }

  return {
    apri({ tipo } = {}) {
      spegni();
      giro++;
      errore = null;
      inCorso = false;
      stato = tipo === "video" ? "avviso" : tipo === "foto" ? "foto" : "chiusa";
      avvisa();
    },
    async conferma() {
      if (stato !== "avviso") return;
      await accendi();
    },
    async riprova() {
      if (stato !== "senza_fotocamera") return;
      await accendi();
    },
    async passaFoto() {
      if (inCorso || !["anteprima", "senza_fotocamera", "attesa_fotocamera"].includes(stato)) return;
      const prima = stato;
      spegni();
      giro++;
      inCorso = true;
      errore = null;
      avvisa();
      const r = await Promise.resolve().then(passaAlleFoto).catch(() => ({ ok: false }));
      inCorso = false;
      if (r && r.ok) stato = "foto";
      else {
        stato = prima === "anteprima" || prima === "attesa_fotocamera" ? "senza_fotocamera" : prima;
        errore = (r && typeof r.testo === "string" && r.testo) || "Non è andata. Riprova tra poco.";
      }
      avvisa();
    },
    // Il server può dire «foto» (l'altra persona ha cambiato scelta) o che non è più il momento.
    aggiornaTipo(tipo) {
      if (stato === "chiusa") return;
      if (tipo === "video") return;
      spegni();
      giro++;
      stato = tipo === "foto" ? "foto" : "chiusa";
      avvisa();
    },
    chiudi() {
      spegni();
      giro++;
      stato = "chiusa";
      errore = null;
      inCorso = false;
      avvisa();
    },
    modello: () => ({ stato, errore, inCorso }),
    schermo: () => schermo,
  };
}

// La vista (h come in flusso.js). null se la sala è chiusa. Lo schermo è lo stesso elemento <video> a ogni disegno,
// così l'anteprima non si interrompe.
export function vistaSala(h, sala) {
  const m = sala.modello();
  if (m.stato === "chiusa") return null;
  const parti = [];
  if (m.stato === "avviso") {
    parti.push(h("p", { id: "sala-avviso", role: "note" }, TESTI_SALA.avviso),
      h("button", { classe: "bottone", type: "button", "aria-describedby": "sala-avviso", onclick: () => sala.conferma() }, TESTI_SALA.capito));
  }
  if (m.stato === "attesa_fotocamera") parti.push(h("p", { classe: "nota", role: "status" }, TESTI_SALA.attendi));
  if (m.stato === "anteprima") {
    const schermo = sala.schermo();
    parti.push(h("div", { classe: "anteprima-sfocata" }, schermo),
      h("p", { classe: "nota", role: "status" }, TESTI_SALA.anteprima),
      h("button", { classe: "bottone-secondario", type: "button", disabled: m.inCorso, onclick: () => sala.passaFoto() }, TESTI_SALA.passaFoto));
  }
  if (m.stato === "senza_fotocamera") {
    parti.push(h("p", { classe: "errore", role: "alert" }, TESTI_SALA.senzaFotocamera),
      h("button", { classe: "bottone", type: "button", disabled: m.inCorso, onclick: () => sala.riprova() }, TESTI_SALA.riprova),
      h("button", { classe: "bottone-secondario", type: "button", disabled: m.inCorso, onclick: () => sala.passaFoto() }, TESTI_SALA.passaFoto));
  }
  if (m.stato === "foto") parti.push(h("p", { role: "status" }, TESTI_SALA.foto));
  if (m.errore) parti.push(h("p", { classe: "errore", role: "alert" }, m.errore));
  return h("div", { classe: "sala-attesa", role: "group", "aria-labelledby": "sala-titolo" },
    h("h2", { id: "sala-titolo" }, TESTI_SALA.titolo), parti);
}
