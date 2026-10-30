# Prova del salvataggio passo per passo (issue #2) con Chromium e un Supabase FINTO in memoria (nessuna rete, nessun dato reale).
# Uso: node scripts/server_locale.mjs "$PWD" &  poi  python3 scripts/prova_salvataggio.py <cartella per le schermate> <foto jpg di prova>
# Controlla: ogni «Continua» salva; uscendo a metà (dopo la voce e dopo il primo tema del questionario) si riparte dal passo
# lasciato; i file hanno solo i nomi fissi; la data del consenso non parte dal telefono; «Elimina il mio account» chiama
# il server; il minorenne viene cancellato subito; console pulita.
import asyncio, sys, json, re, base64
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright

S = sys.argv[1]
FOTO = sys.argv[2]
SUPA = "https://abcdefghijklmnopqrst.supabase.co"
CONFIG = {"pronta": True, "accesso": True, "supabaseUrl": SUPA, "supabaseAnonKey": "sb_publishable_finta"}
ID = "11111111-2222-4333-8444-555555555555"
ACC = "eyJhbGciOiJIUzI1NiJ9." + base64.urlsafe_b64encode(json.dumps({"sub": ID, "role": "authenticated"}).encode()).decode().rstrip("=") + ".firma"
TOKEN = {"access_token": ACC, "refresh_token": "ref", "expires_in": 3600, "user": {"id": ID}}

db = {"profili": {}, "filtri": {}, "questionario": [], "voci": {}, "foto": {}}
eliminazioni = []

async def supabase(route):
    r = route.request
    u = urlparse(r.url)
    q = parse_qs(u.query)
    p = u.path
    ok = lambda corpo, stato=200: route.fulfill(status=stato, body=json.dumps(corpo), content_type="application/json")
    if r.headers.get("apikey") != "sb_publishable_finta":
        return await ok({"message": "apikey mancante"}, 401)
    if p == "/auth/v1/otp":
        return await ok({})
    if p == "/auth/v1/verify":
        return await ok(TOKEN)
    if p == "/auth/v1/logout":
        return await route.fulfill(status=204, body="")
    assert r.headers.get("authorization") == f"Bearer {ACC}", ("token mancante", r.url)
    m = re.match(r"^/rest/v1/(profili|filtri)$", p)
    if m:
        tabella = m.group(1)
        if r.method == "GET":
            return await ok([db[tabella]] if db[tabella] else [])
        corpo = json.loads(r.post_data)
        chiave = "id" if tabella == "profili" else "utente_id"
        assert corpo[chiave] == ID and q["on_conflict"] == [chiave], corpo
        assert "consenso_cerco_il" not in corpo, "la data del consenso non deve partire dal telefono"
        db[tabella].update(corpo)
        return await route.fulfill(status=201, body="")
    if p == "/rest/v1/questionario":
        if r.method == "GET":
            return await ok(db["questionario"][-1:])
        corpo = json.loads(r.post_data)
        if r.method == "POST":
            db["questionario"].append({**corpo, "in_vigore_dal": "2026-11-02T08:00:00Z"})
        else:
            db["questionario"][-1].update(corpo)
        return await route.fulfill(status=201, body="")
    m = re.match(r"^/storage/v1/object/list/(voci|foto)$", p)
    if m:
        assert json.loads(r.post_data)["prefix"] == ID
        return await ok([{"name": n, "id": "x"} for n in sorted(db[m.group(1)])])
    m = re.match(r"^/storage/v1/object/(authenticated/)?(voci|foto)/([^/]+)/([^/]+)$", p)
    if m:
        assert m.group(3) == ID, p
        cartella, nome = m.group(2), m.group(4)
        if r.method == "POST":
            assert r.headers.get("x-upsert") == "true"
            db[cartella][nome] = (r.post_data_buffer, r.headers.get("content-type"))
            return await ok({"Key": f"{cartella}/{ID}/{nome}"})
        dati, tipo = db[cartella][nome]
        return await route.fulfill(status=200, body=dati, content_type=tipo)
    raise AssertionError(f"chiamata inattesa {r.method} {r.url}")

async def elimina(route):
    eliminazioni.append(route.request.headers.get("authorization"))
    await route.fulfill(status=200, body='{"ok":true}', content_type="application/json")

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, permissions=["microphone"])
        await ctx.route(SUPA + "/**", supabase)
        await ctx.route("**/app/config.json", lambda route: route.fulfill(status=200, body=json.dumps(CONFIG), content_type="application/json"))
        await ctx.route("**/app/api/elimina-account", elimina)
        errori = []
        pg = await ctx.new_page()
        pg.on("console", lambda m: errori.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: errori.append(f"pageerror: {e}"))
        pg.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        n = [0]
        async def foto(nome):
            n[0] += 1; await pg.screenshot(path=f"{S}/salva-{n[0]:02d}-{nome}.png", full_page=True)
        async def clic(testo):
            await pg.locator("button").filter(has_text=re.compile("^" + re.escape(testo) + "$")).first.click()
        async def ferma():
            await pg.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Ferma').click()")
        async def titolo(atteso):
            await pg.wait_for_function("t => document.querySelector('h1') && document.querySelector('h1').textContent === t", arg=atteso)

        # 1. Minorenne: l'account appena creato con l'email viene cancellato subito.
        await pg.goto("http://localhost:8787/app/"); await clic("Entra")
        await pg.fill("#email", "prova@example.com"); await clic("Mandami il link"); await pg.fill("#codice", "123456"); await clic("Entra")
        await pg.wait_for_selector("#giorno")
        await pg.select_option("#giorno", "1"); await pg.select_option("#mese", "5"); await pg.select_option("#anno", "2012"); await clic("Continua")
        await titolo("Presente è solo per maggiorenni.")
        await pg.wait_for_function("() => !document.body.textContent.includes('Salvataggio…')")
        assert eliminazioni == [f"Bearer {ACC}"], eliminazioni
        assert not db["profili"], "del minorenne non si salva nulla"
        assert await pg.evaluate("localStorage.getItem('presente.sessione')") is None
        await foto("minorenne")

        # 2. Iscrizione vera fino alla voce, poi si chiude l'app.
        await pg.goto("http://localhost:8787/app/"); await clic("Entra")
        await pg.fill("#email", "prova@example.com"); await clic("Mandami il link"); await pg.fill("#codice", "123456"); await clic("Entra")
        await pg.wait_for_selector("#giorno")
        await pg.select_option("#giorno", "9"); await pg.select_option("#mese", "5"); await pg.select_option("#anno", "1994"); await clic("Continua")
        await pg.check("#accetto"); await clic("Continua")
        await pg.fill("#nome", "Giulia"); await pg.locator("#nome").blur()
        await pg.select_option("#citta", "altra"); await pg.fill("#citta-altra", "Lecce"); await clic("Donna"); await clic("Continua")
        await clic("Uomini"); await pg.check("#consenso-cerco"); await clic("Una storia seria"); await clic("Forse"); await clic("Indifferente"); await clic("Continua")
        await clic("● Registra"); await pg.wait_for_timeout(6000); await ferma()
        await pg.wait_for_selector(".registratore audio"); await clic("Continua")
        await titolo("Tre risposte a voce")
        assert db["profili"]["passo"] == 7 and db["profili"]["data_nascita"] == "1994-05-09" and db["profili"]["citta"] == "Lecce", db["profili"]
        assert db["filtri"]["cerco"] == "uomini" and db["filtri"]["consenso_versione_informativa"], db["filtri"]
        assert list(db["voci"]) == ["presentazione"] and db["voci"]["presentazione"][1].startswith("audio/"), db["voci"].keys()
        await foto("dopo-voce")

        # 3. Rientro: si riparte dalle tre risposte, con la voce già registrata.
        await pg.reload(); await titolo("Tre risposte a voce"); await foto("rientro-risposte")
        await clic("Indietro"); await titolo("La tua voce")
        assert await pg.locator(".registratore audio").count() == 1, "la voce salvata non si riascolta"
        await clic("Continua"); await titolo("Tre risposte a voce")
        for d in ["Una cosa che ti fa ridere sempre", "Il posto dove ti senti a casa", "Racconta la tua domenica perfetta, dalla colazione alla sera."]:
            await clic(d)
        for i in range(3):
            await pg.locator("button", has_text="Registra").first.click(); await pg.wait_for_timeout(6200)
            await ferma(); await pg.wait_for_timeout(400)
        await clic("Continua")
        await pg.wait_for_selector('[data-nome="q1"]')
        assert sorted(db["voci"]) == ["presentazione", "risposta-1", "risposta-2", "risposta-3"], db["voci"].keys()
        assert db["profili"]["domande_voce"] == [0, 1, 4], db["profili"]

        # 4. Primo tema del questionario, poi si chiude: al rientro si riparte dalla domanda 4.
        for q in range(1, 4):
            bottoni = pg.locator(f'.scelte [data-nome="q{q}"]')
            if q == 1: await bottoni.nth(0).click(); await bottoni.nth(1).click()
            else: await bottoni.nth(0).click()
            imp = pg.locator('.quanto-conta .scelta')
            if await imp.count(): await imp.nth(2).click()
            await pg.get_by_role("button", name="Avanti").click()
        await pg.wait_for_selector('[data-nome="q4"]')
        assert db["questionario"] and db["questionario"][-1]["importanza"] == {"valori": 3}, db["questionario"]
        await pg.reload(); await pg.wait_for_selector('[data-nome="q4"]'); await foto("rientro-questionario")
        for q in range(4, 16):
            bottoni = pg.locator(f'.scelte [data-nome="q{q}"]')
            if q == 13: await bottoni.nth(0).click(); await bottoni.nth(1).click()
            elif q == 15: await bottoni.nth(2).click()
            else: await bottoni.nth(0).click()
            imp = pg.locator('.quanto-conta .scelta')
            if await imp.count(): await imp.nth(1).click()
            await pg.get_by_role("button", name="Fine questionario" if q == 15 else "Avanti").click()
        await titolo("Le tue foto")
        assert len(db["questionario"][-1]["risposte"]) == 15 and len(db["questionario"][-1]["importanza"]) == 6, db["questionario"][-1]
        assert len(db["questionario"]) == 1, "una sola riga per la prossima settimana"

        # 5. Foto e fine.
        for i in range(3):
            await pg.set_input_files(f"#foto-{i}", FOTO); await pg.wait_for_timeout(500)
        await clic("Continua"); await titolo("Il tuo profilo è pronto.")
        assert sorted(db["foto"]) == ["foto-1", "foto-2", "foto-3"] and all(t == "image/jpeg" for _, t in db["foto"].values()), db["foto"].keys()
        assert db["profili"]["passo"] == 10
        await foto("fatto")

        # 6. Modifica del profilo: il passo salvato non torna indietro.
        await clic("Modifica il profilo"); await titolo("Chi sei"); await clic("Continua"); await titolo("Chi cerchi")
        assert db["profili"]["passo"] == 10, db["profili"]["passo"]
        await pg.reload(); await titolo("Il tuo profilo è pronto.")

        # 7. Elimina il mio account.
        await clic("Elimina il mio account")
        await pg.wait_for_function("() => location.pathname === '/app/' && document.querySelector('h1') && document.querySelector('h1').textContent.startsWith('Ci si conosce')")
        assert len(eliminazioni) == 2 and eliminazioni[1] == f"Bearer {ACC}", eliminazioni
        assert await pg.evaluate("localStorage.getItem('presente.sessione')") is None
        await foto("eliminato")

        await b.close()
        print("salvataggio: tutte le prove passate")
        print("console:", "pulita" if not errori else errori)
        if errori: sys.exit(1)

asyncio.run(main())
