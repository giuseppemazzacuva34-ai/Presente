// Foto (passo 10 della #2): il telefono le ricodifica prima di tutto, così spariscono i dati EXIF (posizione GPS,
// modello del telefono, data) e il file diventa un JPEG leggero. Lato lungo massimo 1600 pixel.
// Nell'anteprima le foto restano solo sul telefono e non si vedono da nessun'altra parte.

export const LATO_MASSIMO = 1600;
export const PESO_MASSIMO = 10 * 1024 * 1024;
const TIPI = ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"];

export async function preparaFoto(file) {
  if (!file) return { errore: "Nessuna foto scelta." };
  if (file.size > PESO_MASSIMO) return { errore: "La foto supera i 10 MB." };
  if (file.type && !TIPI.includes(file.type.toLowerCase())) return { errore: "Formato non supportato: usa JPG, PNG o HEIC." };
  let immagine;
  try {
    // imageOrientation: la foto resta dritta anche senza EXIF.
    immagine = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { errore: "Questo telefono non riesce ad aprire la foto. Prova con un JPG." };
  }
  const scala = Math.min(1, LATO_MASSIMO / Math.max(immagine.width, immagine.height));
  const tela = document.createElement("canvas");
  tela.width = Math.round(immagine.width * scala);
  tela.height = Math.round(immagine.height * scala);
  tela.getContext("2d").drawImage(immagine, 0, 0, tela.width, tela.height);
  immagine.close && immagine.close();
  const blob = await new Promise((r) => tela.toBlob(r, "image/jpeg", 0.85));
  if (!blob) return { errore: "Non siamo riusciti a preparare la foto." };
  return { blob, url: URL.createObjectURL(blob), larghezza: tela.width, altezza: tela.height };
}
