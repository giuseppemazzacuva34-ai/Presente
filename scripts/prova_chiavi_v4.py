# Prova nel browser delle schermate 33 «Le chiavi» e 34 «Chiave data» del design v4 (#349, linea C) con Chromium,
# Supabase FINTO in memoria e Worker finto (stessi dati finti di prova_stanza_viva.py). Nessun dato reale.
# Uso: node scripts/server_locale.mjs "$PWD" &  poi  python3 scripts/prova_chiavi_v4.py <cartella per le schermate>
# Controlla: «Dai una chiave» sulla scheda apre la 33 al posto della stanza, fuoco nel campo; «Dai la chiave» manda
# solo azione, a e frase; poi la 34 con la frase e tre pulsanti; «Cambia frase» → «Salva» torna alla 34;
# «Torna alla stanza» torna alla stanza; tutto da tastiera; console pulita.
import asyncio, sys, json, re, base64
from urllib.parse import urlparse
from playwright.async_api import async_playwright

S = sys.argv[1]
SUPA = "https://abcdefghijklmnopqrst.supabase.co"
CONFIG = {"pronta": True, "accesso": True, "supabaseUrl": SUPA, "supabaseAnonKey": "sb_publishable_finta"}
ID = "11111111-2222-4333-8444-555555555555"
ACC = "eyJhbGciOiJIUzI1NiJ9." + base64.urlsafe_b64encode(json.dumps({"sub": ID, "role": "authenticated"}).encode()).decode().rstrip("=") + ".firma"
TOKEN = {"access_token": ACC, "refresh_token": "ref", "expires_in": 3600, "user": {"id": ID}}
PROFILO = {"id": ID, "passo": 10, "nome": "Giulia", "provincia": "MI", "mi_presento_come": "donna",
           "data_nascita": "1994-05-09", "regole_accettate_il": "2026-11-01T10:00:00Z"}
MARCO, DARIO, LUCA, SARA = ("a0000000-0000-4000-8000-00000000000" + str(n) for n in range(1, 5))
COMPAGNI = [{"utente_id": MARCO, "nome": "Marco", "eta": 35, "citta": "Milano"},
            {"utente_id": DARIO, "nome": "Dario", "eta": 34, "citta": "Monza"},
            {"utente_id": LUCA, "nome": "Luca", "eta": 33, "citta": "Milano"},
            {"utente_id": SARA, "nome": "Sara", "eta": 31, "citta": "Milano"}]
STATI = [{"id": MARCO, "stato": "online", "testo": "online", "con": None, "gruppo": "uomini"},
         {"id": DARIO, "stato": "in_chiamata", "testo": "in chiamata", "con": SARA, "gruppo": "uomini"},
         {"id": LUCA, "stato": "non_in_linea", "testo": "non in linea · da 2 h", "con": None, "gruppo": "uomini"},
         {"id": SARA, "stato": "in_chiamata", "testo": "in chiamata", "con": DARIO, "gruppo": "donne"}]
APP_ID = "b0000000-0000-4000-8000-000000000001"

def adesso_piu(ore):
    import datetime
    t = datetime.datetime.now(datetime.timezone.utc).replace(minute=0, second=0, microsecond=0) + datetime.timedelta(hours=ore)
    return t.strftime("%Y-%m-%dT%H:%M:%S.000Z")

CHIUDE = adesso_piu(72)

async def main():
    mandate = []
    date = []
    stato = lambda: {"ok": True, "stanza": True, "chiude_il": CHIUDE, "chiuse": False, "restanti": 2 - len(date), "date": list(date)}
    async def supabase(route):
        r = route.request
        p = urlparse(r.url).path
        ok = lambda corpo, stato=200: route.fulfill(status=stato, body=json.dumps(corpo), content_type="application/json")
        if p == "/auth/v1/otp": return await ok({})
        if p == "/auth/v1/verify": return await ok(TOKEN)
        if p == "/rest/v1/profili": return await ok([PROFILO])
        if p == "/rest/v1/filtri": return await ok([{"cerco": "tutti", "eta_min": 25, "eta_max": 45, "raggio": "italia"}])
        if p == "/rest/v1/rpc/compagni_di_stanza": return await ok(COMPAGNI)
        return await ok([])
    async def worker(route):
        r = route.request
        u = urlparse(r.url)
        ok = lambda corpo, stato=200: route.fulfill(status=stato, body=json.dumps(corpo), content_type="application/json")
        if u.path == "/app/api/chiavi" and r.method == "POST":
            c = json.loads(r.post_data); mandate.append(c)
            if c["azione"] == "dai": date.append({"a": c["a"], "frase": c["frase"] or None})
            if c["azione"] == "frase":
                for k in date:
                    if k["a"] == c["a"]: k["frase"] = c["frase"] or None
            if c["azione"] == "riprendi": date[:] = [k for k in date if k["a"] != c["a"]]
            s = stato(); s.pop("ok"); return await ok({"ok": True, "stato": s})
        if u.path == "/app/api/chiavi": return await ok(stato())
        if u.path == "/app/api/stanza/presenza":
            return await ok({"ok": True, "inStanza": True} if r.method == "POST" else {"ok": True, "persone": STATI})
        if u.path == "/app/api/stanza/appuntamenti": return await ok({"ok": True, "appuntamenti": []})
        if u.path == "/app/api/chiamata/pulsanti": return await ok({"ok": True, "pulsanti": [], "chiamate": [{"id": MARCO, "n": 2}]})
        if u.path in ("/app/api/provincia-lista", "/app/api/zona"): return await ok({})
        return await ok({"ok": False, "motivo": "spento"}, 404)
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        await ctx.route(SUPA + "/**", supabase)
        await ctx.route("**/app/config.json", lambda route: route.fulfill(status=200, body=json.dumps(CONFIG), content_type="application/json"))
        await ctx.route(re.compile(r".*/app/api/.*"), worker)
        errori = []
        pg = await ctx.new_page()
        pg.on("console", lambda m: errori.append(f"{m.type}: {m.text}") if m.type == "error" and "404" not in m.text else None)
        pg.on("pageerror", lambda e: errori.append(f"pageerror: {e}"))
        clic = lambda testo: pg.locator("button").filter(has_text=re.compile("^" + re.escape(testo) + "$")).first.click()
        await pg.goto("http://localhost:8787/app/"); await clic("Entra")
        await pg.fill("#email", "prova@example.com"); await clic("Mandami il link"); await pg.fill("#codice", "123456"); await clic("Entra")
        riga_marco = pg.locator("li.compagno").filter(has_text="Marco")
        await riga_marco.locator("button[aria-label='Dai una chiave a Marco']").wait_for(timeout=15000)
        await riga_marco.locator("button[aria-label='Dai una chiave a Marco']").click()
        await pg.wait_for_selector("section.chiave-v4 h1:has-text('Dai una chiave')")
        assert await pg.locator(".tua-stanza").count() == 0, "la 33 prende la pagina"
        assert await pg.evaluate("document.activeElement && document.activeElement.id") == "chiave-frase", "fuoco nel campo"
        await pg.keyboard.type("La tua risata mi è rimasta in testa.")
        await pg.screenshot(path=f"{S}/33-le-chiavi.png")
        await pg.keyboard.press("Tab"); await pg.keyboard.press("Tab")  # Indietro, poi Dai la chiave
        assert (await pg.evaluate("document.activeElement.textContent")) == "Dai la chiave"
        await pg.keyboard.press("Enter")
        await pg.wait_for_selector("section.chiave-data h1:has-text('Hai dato una chiave')")
        assert mandate == [{"azione": "dai", "a": MARCO, "frase": "La tua risata mi è rimasta in testa."}], mandate
        testo = await pg.locator("section.chiave-data").inner_text()
        assert "Ti resta 1 chiave".upper() in testo.upper() and "La tua risata mi è rimasta in testa." in testo, testo
        await pg.screenshot(path=f"{S}/34-chiave-data.png")
        await clic("Cambia frase")
        await pg.wait_for_selector("section.chiave-v4 h1:has-text('Modifica la frase')")
        await pg.fill("#chiave-frase", "Il treno delle 8, ancora.")
        await clic("Salva")
        await pg.wait_for_selector("section.chiave-data blockquote:has-text('Il treno delle 8, ancora.')")
        await clic("Torna alla stanza")
        await pg.wait_for_selector(".tua-stanza")
        assert "Hai dato una chiave" in await pg.locator("li.compagno").filter(has_text="Marco").inner_text()
        assert mandate[-1] == {"azione": "frase", "a": MARCO, "frase": "Il treno delle 8, ancora."}, mandate
        await b.close()
    assert not errori, errori
    print("chiavi v4 (33-34): ok, console pulita")

asyncio.run(main())
