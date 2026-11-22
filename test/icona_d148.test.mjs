// D148 B (Giuseppe, 22/11): icona dell'app e del sito = due barre di voce avorio + «!» rosso su nero
// (icona-b.svg del design system Presente!, sezione 3). Le PNG dell'app sono la stessa icona alle misure giuste.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const radice = new URL("../landing/", import.meta.url);

test("favicon: fondo nero, due barre avorio e «!» rosso", () => {
  const svg = readFileSync(new URL("favicon.svg", radice), "utf8");
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1024 1024">/);
  assert.match(svg, /<rect width="1024" height="1024" rx="0" fill="#0E0D10">/);
  assert.equal((svg.match(/fill="#F2EDE4"/g) || []).length, 2);
  assert.match(svg, /<g fill="#E8432B" transform="rotate\(10 [^"]+\)"><rect [^>]+><\/rect><circle [^>]+><\/circle><\/g>/);
  assert.doesNotMatch(svg, /<script|href=/);
});

const misura = (file) => {
  const b = readFileSync(new URL(`app/icone/${file}`, radice));
  assert.equal(b.toString("ascii", 12, 16), "IHDR");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

test("icone PNG dell'app alle misure del manifest e di Apple", () => {
  assert.deepEqual(misura("icona-192.png"), [192, 192]);
  assert.deepEqual(misura("icona-512.png"), [512, 512]);
  assert.deepEqual(misura("icona-maschera-512.png"), [512, 512]);
  assert.deepEqual(misura("apple-touch-icon.png"), [180, 180]);
});
