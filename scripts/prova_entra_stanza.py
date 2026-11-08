# Prova nel browser di «Entra nella stanza» e della domanda «Vuoi entrare intanto nella Stanza Italia?» (#3 v1, v1.1,
# v1.2) con Chromium e Supabase FINTO in memoria. Nessun dato reale.
# Uso: node scripts/server_locale.mjs "$PWD" &  poi  python3 scripts/prova_entra_stanza.py <cartella per le schermate>
# Controlla: profilo completo con «Solo la mia zona» e zona spenta → contatore senza «Intanto entri nella Stanza Italia»,
# domanda con i due pulsanti; «Aspetto la mia zona» la nasconde senza salvare; «Sì, allarga il raggio» salva solo
# raggio «italia»; «Entra nella stanza» manda un corpo vuoto e mostra lunedì e scadenza; «Ci ripenso» cancella; console pulita.
import asyncio, sys, json, re, base64
from urllib.parse import urlparse
from playwright.async_api import async_playwright

S = sys.argv[1]
SUPA = "https://abcdefghijklmnopqrst.supabase.co"
CONFIG = {"pronta": True, "accesso": True, "supabaseUrl": SUPA, "supabaseAnonKey": "sb_publishable_finta"}
ID = "11111111-2222-4333-8444-555555555555"
ACC = "eyJhbGciOiJIUzI1NiJ9." + base64.urlsafe_b64encode(json.dumps({"sub": ID, "role": "authenticated"}).encode()).decode().rstrip("=") + ".firma"
TOKEN = {"access_token": ACC, "refresh_token": "ref", "expires_in": 3600, "user": {"id": ID}}
PROFILO = {"id": ID, "passo": 10, "nome": "Giulia", "provincia": "MB", "mi_presento_come": "donna",
           "data_nascita": "1994-05-09", "regole_accettate_il": "2026-11-01T10:00:00Z"}
LUNEDI = "2026-11-16T08:00:00+00:00"
ZONA = "Milano e dintorni: mancano 7 persone per aprire le stanze della tua zona. Intanto entri nella Stanza Italia."

async def prova(b, nome, aspetta):
    db = {"profili": dict(PROFILO), "filtri": {"cerco": "uomini", "eta_min": 30, "eta_max": 45, "raggio": "citta",
                                               "cosa_cerco": "storia_seria", "figli": "forse", "fumo": "no"}, "conferme": []}
    filtri_salvati, conferme_mandate = [], []
    async def supabase(route):
        r = route.request
        p = urlparse(r.url).path
        ok = lambda corpo, stato=200: route.fulfill(status=stato, body=json.dumps(corpo), content_type="application/json")
        if p == "/auth/v1/otp": return await ok({})
        if p == "/auth/v1/verify": return await ok(TOKEN)
        if p == "/rest/v1/questionario": return await ok([])
        if p == "/rest/v1/conferme_stanza":
            if r.method == "GET": return await ok([{"apre_il": c} for c in db["conferme"]])
            if r.method == "POST":
                conferme_mandate.append(r.post_data); db["conferme"] = [LUNEDI]; return await ok([{"apre_il": LUNEDI}], 201)
            if r.method == "DELETE":
                via = [{"apre_il": c} for c in db["conferme"]]; db["conferme"] = []; return await ok(via)
        m = re.match(r"^/rest/v1/(profili|filtri)$", p)
        if m:
            if r.method == "GET": return await ok([db[m.group(1)]])
            corpo = json.loads(r.post_data)
            if m.group(1) == "filtri": filtri_salvati.append(corpo)
            db[m.group(1)].update(corpo); return await route.fulfill(status=201, body="")
        if re.match(r"^/storage/v1/object/list/", p): return await ok([])
        raise AssertionError(f"chiamata inattesa {r.method} {r.url}")
    ctx = await b.new_context(viewport={"width": 390, "height": 844})
    await ctx.route(SUPA + "/**", supabase)
    await ctx.route("**/app/config.json", lambda route: route.fulfill(status=200, body=json.dumps(CONFIG), content_type="application/json"))
    await ctx.route("**/app/api/provincia-lista", lambda route: route.fulfill(status=200, body='{"sigla":null}', content_type="application/json"))
    await ctx.route("**/app/api/zona", lambda route: route.fulfill(status=200, body=json.dumps({"zona": "Milano e dintorni", "accesa": False, "testo": ZONA}), content_type="application/json"))
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
    await pg.wait_for_selector("#contatore-zona")
    testo = await pg.locator("#contatore-zona").inner_text()
    assert testo == "Milano e dintorni: mancano 7 persone per aprire le stanze della tua zona.", testo
    await pg.wait_for_selector("#domanda-italia")
    await pg.wait_for_selector("button:has-text('Entra nella stanza'):not([disabled])")
    await pg.screenshot(path=f"{S}/stanza-{nome}-home.png", full_page=True)

    if aspetta:
        await clic("Aspetto la mia zona")
        assert not await pg.locator("#domanda-italia").count(), "la domanda deve sparire"
        assert filtri_salvati == [], filtri_salvati
        assert db["filtri"]["raggio"] == "citta"
    else:
        await clic("Sì, allarga il raggio")
        await pg.wait_for_selector("text=Fatto: entri nella Stanza Italia.")
        assert filtri_salvati == [{"utente_id": ID, "raggio": "italia"}], filtri_salvati
        assert not await pg.locator("#domanda-italia").count()
        assert "Intanto entri nella Stanza Italia." in await pg.locator("#contatore-zona").inner_text()

    await clic("Entra nella stanza")
    await pg.wait_for_selector("#conferma-stanza")
    conferma = await pg.locator("#conferma-stanza").inner_text()
    assert conferma == "Ci sei: entri nella stanza di lunedì 16 novembre alle 9:00. Puoi ripensarci fino a domenica 15 novembre alle 23:59.", conferma
    assert conferme_mandate == ["{}"], conferme_mandate
    await pg.screenshot(path=f"{S}/stanza-{nome}-confermata.png", full_page=True)
    await clic("Ci ripenso")
    await pg.wait_for_selector("text=Va bene: questa settimana non entri.")
    assert db["conferme"] == []
    await ctx.close()
    print(f"{nome}: ok", "console pulita" if not errori else errori)
    return errori

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        errori = await prova(b, "aspetta", True) + await prova(b, "allarga", False)
        await b.close()
    assert not errori, errori

asyncio.run(main())
