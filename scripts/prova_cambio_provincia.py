# Prova nel browser del cambio della provincia da «Il mio profilo» (#2 v1.3) con Chromium e Supabase FINTO in memoria.
# Uso: node scripts/server_locale.mjs "$PWD" &  poi  python3 scripts/prova_cambio_provincia.py <cartella per le schermate>
# Controlla: profilo completo → «Cambia provincia» → «Chi sei» con «Annulla» e «Salva»; scrivendo un'altra provincia compare
# «Il cambio vale dalla stanza di lunedì …»; «Salva» salva e torna al profilo con l'avviso; «Annulla» non salva nulla;
# secondo cambio entro 7 giorni rifiutato dal server → messaggio del server e campo com'era; console pulita.
import asyncio, sys, json, re, base64
from urllib.parse import urlparse
from playwright.async_api import async_playwright

S = sys.argv[1]
SUPA = "https://abcdefghijklmnopqrst.supabase.co"
CONFIG = {"pronta": True, "accesso": True, "supabaseUrl": SUPA, "supabaseAnonKey": "sb_publishable_finta"}
ID = "11111111-2222-4333-8444-555555555555"
ACC = "eyJhbGciOiJIUzI1NiJ9." + base64.urlsafe_b64encode(json.dumps({"sub": ID, "role": "authenticated"}).encode()).decode().rstrip("=") + ".firma"
TOKEN = {"access_token": ACC, "refresh_token": "ref", "expires_in": 3600, "user": {"id": ID}}
PROFILO = {"id": ID, "passo": 10, "nome": "Giulia", "provincia": "RM", "mi_presento_come": "donna",
           "data_nascita": "1994-05-09", "regole_accettate_il": "2026-11-01T10:00:00Z"}

async def prova(b, nome, rifiuta):
    db = {"profili": dict(PROFILO), "filtri": {"cerco": "uomini", "eta_min": 30, "eta_max": 45, "raggio": "citta",
                                               "cosa_cerco": "storia_seria", "figli": "forse", "fumo": "no"}}
    salvati = []
    async def supabase(route):
        r = route.request
        p = urlparse(r.url).path
        ok = lambda corpo, stato=200: route.fulfill(status=stato, body=json.dumps(corpo), content_type="application/json")
        if p == "/auth/v1/otp": return await ok({})
        if p == "/auth/v1/verify": return await ok(TOKEN)
        if p == "/rest/v1/questionario": return await ok([])
        if p == "/rest/v1/conferme_stanza" and r.method == "GET": return await ok([])
        m = re.match(r"^/rest/v1/(profili|filtri)$", p)
        if m:
            if r.method == "GET": return await ok([db[m.group(1)]])
            corpo = json.loads(r.post_data)
            if m.group(1) == "profili" and corpo.get("provincia") not in (None, db["profili"]["provincia"]) and rifiuta:
                return await ok({"message": "Puoi cambiarla di nuovo dal 13/11."}, 400)
            salvati.append(corpo)
            db[m.group(1)].update(corpo); return await route.fulfill(status=201, body="")
        if re.match(r"^/storage/v1/object/list/", p): return await ok([])
        raise AssertionError(f"chiamata inattesa {r.method} {r.url}")
    ctx = await b.new_context(viewport={"width": 390, "height": 844})
    await ctx.route(SUPA + "/**", supabase)
    await ctx.route("**/app/config.json", lambda route: route.fulfill(status=200, body=json.dumps(CONFIG), content_type="application/json"))
    await ctx.route("**/app/api/provincia-lista", lambda route: route.fulfill(status=200, body='{"sigla":null}', content_type="application/json"))
    await ctx.route("**/app/api/zona", lambda route: route.fulfill(status=200, body='{"zona":null,"accesa":false,"testo":null}', content_type="application/json"))
    errori = []
    pg = await ctx.new_page()
    pg.on("console", lambda m: errori.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: errori.append(f"pageerror: {e}"))
    async def clic(testo):
        await pg.locator("button").filter(has_text=re.compile("^" + re.escape(testo) + "$")).first.click()
    h1 = lambda testo: pg.wait_for_function(f"() => document.querySelector('h1') && document.querySelector('h1').textContent === {json.dumps(testo)}")
    await pg.goto("http://localhost:8787/app/"); await clic("Entra")
    await pg.fill("#email", "prova@example.com"); await clic("Mandami il link"); await pg.fill("#codice", "123456"); await clic("Entra")
    await h1("Il tuo profilo è pronto.")

    # «Annulla»: nessun salvataggio, la provincia resta Roma.
    await clic("Cambia provincia"); await h1("Chi sei")
    assert await pg.input_value("#provincia") == "Roma"
    assert not await pg.locator("#provincia-cambio").is_visible(), "la riga del cambio compare solo se la provincia cambia"
    await pg.fill("#provincia", "Lecce")
    assert await pg.locator("#provincia-cambio").is_visible()
    await clic("Annulla"); await h1("Il tuo profilo è pronto.")
    assert salvati == [], salvati
    assert "Roma" in await pg.locator(".riepilogo").inner_text()

    # «Salva»: un cambio, si torna al profilo con l'avviso.
    await clic("Cambia provincia"); await h1("Chi sei")
    await pg.fill("#provincia", "Lecce")
    testo = await pg.locator("#provincia-cambio").inner_text()
    assert re.match(r"^Il cambio vale dalla stanza di lunedì \d\d/\d\d: quella in corso non cambia\.", testo), testo
    await pg.screenshot(path=f"{S}/cambio-{nome}-chi.png", full_page=True)
    await clic("Salva")
    if rifiuta:
        await pg.wait_for_selector("text=Puoi cambiarla di nuovo dal 13/11.")
        assert await pg.input_value("#provincia") == "Roma", "il campo deve tornare com'era"
        assert db["profili"]["provincia"] == "RM"
    else:
        await h1("Il tuo profilo è pronto.")
        assert db["profili"]["provincia"] == "LE", db["profili"]
        assert "Lecce" in await pg.locator(".riepilogo").inner_text()
        avviso = await pg.locator("[role=status]").inner_text()
        assert re.match(r"^Provincia cambiata: Lecce\. Vale dalla stanza di lunedì \d\d/\d\d\.$", avviso), avviso
        assert db["profili"]["passo"] == 10, "il profilo resta completo"
    await pg.screenshot(path=f"{S}/cambio-{nome}-dopo.png", full_page=True)
    await ctx.close()
    # Il 400 voluto del server finto (cambio rifiutato) il browser lo scrive sempre in console: non è un errore dell'app.
    if rifiuta: errori = [e for e in errori if "status of 400" not in e]
    print(f"{nome}: ok", "console pulita" if not errori else errori)
    return errori

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        errori = []
        errori += await prova(b, "salvato", rifiuta=False)
        errori += await prova(b, "entro-7-giorni", rifiuta=True)
        await b.close()
        if errori: sys.exit(1)

asyncio.run(main())
