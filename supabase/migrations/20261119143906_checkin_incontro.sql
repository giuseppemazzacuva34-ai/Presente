-- Fase 2 · issue #6 spec v1 (CPO, 3/11; D12 A, D18 A) · passo 2f della linea «sviluppatore-b».
-- Check-in «Sono qui» e segnale (spec punto 6, «Regole», criteri di accettazione):
--   checkin_incontro(porta, persona) → text
--     sono_qui (primo check-in, si aspetta l'altro) · avvenuto (secondo check-in, o incontro già avvenuto) · gia_fatto
--     errori: non_nella_porta · nessun_incontro · non_confermato · incontro_chiuso · troppo_presto · troppo_tardi
-- Solo a incontro confermato, da 30 minuti prima a 30 minuti dopo l'ora più l'eventuale «Arrivo in ritardo» (fine
-- esclusa), anche via API: valori uguali a finestraCheckin in api/incontro.js (test/checkin_incontro_database.test.mjs
-- li confronta). Al secondo check-in il server sceglie il segnale, una parola a caso dalla lista di 200 parole neutre
-- (frutti, colori, piante), la stessa sui due telefoni; l'incontro è «avvenuto» e le caparre si sbloccano subito
-- (D12 A, D18 A). Si salva solo l'orario del check-in, mai una posizione. Buca e «nessun check-in» alla fine della
-- finestra arrivano nel passo successivo. Lista e funzione le legge e le chiama SOLO il server.

create table public.parole_segnale (
  parola text primary key check (parola ~ '^[A-ZÀ-Ü][a-zà-ü]{1,19}$')
);
alter table public.parole_segnale enable row level security;
revoke all on public.parole_segnale from public, anon, authenticated;
grant select on public.parole_segnale to service_role;
-- Nessuna regola per authenticated: il segnale arriva al telefono solo dal Worker, dopo il check-in di entrambi.

insert into public.parole_segnale (parola) values
('Albicocca'), ('Ananas'), ('Anguria'), ('Arancia'), ('Avocado'), ('Cachi'), ('Castagna'), ('Cedro'), ('Clementina'), ('Cocco'),
('Dattero'), ('Fragola'), ('Giuggiola'), ('Guava'), ('Kiwi'), ('Lampone'), ('Lime'), ('Limone'), ('Litchi'), ('Mandarino'),
('Mango'), ('Mela'), ('Melagrana'), ('Melone'), ('Mirtillo'), ('Nespola'), ('Nocciola'), ('Noce'), ('Mandorla'), ('Papaya'),
('Pera'), ('Pesca'), ('Pistacchio'), ('Pompelmo'), ('Prugna'), ('Ribes'), ('Susina'), ('Uva'), ('Alchechengi'), ('Bergamotto'),
('Carruba'), ('Chinotto'), ('Cotogna'), ('Kumquat'), ('Pitaya'), ('Mapo'), ('Pinolo'), ('Arachide'), ('Lampascione'), ('Corbezzolo'),
('Ambra'), ('Amaranto'), ('Azzurro'), ('Beige'), ('Blu'), ('Bordeaux'), ('Bronzo'), ('Carminio'), ('Celeste'), ('Ciano'),
('Cobalto'), ('Corallo'), ('Crema'), ('Giallo'), ('Grigio'), ('Indaco'), ('Lilla'), ('Magenta'), ('Ocra'), ('Oliva'),
('Oro'), ('Ottanio'), ('Porpora'), ('Rame'), ('Rosso'), ('Ruggine'), ('Sabbia'), ('Scarlatto'), ('Senape'), ('Seppia'),
('Smeraldo'), ('Terracotta'), ('Tortora'), ('Turchese'), ('Verde'), ('Vermiglio'), ('Zaffiro'), ('Argento'), ('Avorio'), ('Cammello'),
('Cremisi'), ('Granata'), ('Mattone'), ('Perla'), ('Petrolio'), ('Topazio'), ('Acquamarina'), ('Arancione'), ('Ardesia'), ('Antracite'),
('Caramello'), ('Cannella'), ('Zenzero'), ('Vaniglia'), ('Abete'), ('Acacia'), ('Acero'), ('Agave'), ('Alloro'), ('Aloe'),
('Basilico'), ('Betulla'), ('Biancospino'), ('Bosso'), ('Calendula'), ('Camomilla'), ('Cappero'), ('Carciofo'), ('Ciclamino'), ('Cipresso'),
('Edera'), ('Erica'), ('Felce'), ('Frassino'), ('Gelso'), ('Geranio'), ('Gelsomino'), ('Ginepro'), ('Girasole'), ('Glicine'),
('Ibisco'), ('Lavanda'), ('Larice'), ('Leccio'), ('Lentisco'), ('Magnolia'), ('Menta'), ('Mimosa'), ('Mirto'), ('Mughetto'),
('Olivo'), ('Olmo'), ('Oleandro'), ('Ontano'), ('Origano'), ('Ortensia'), ('Papavero'), ('Pino'), ('Pioppo'), ('Platano'),
('Prezzemolo'), ('Quercia'), ('Rosmarino'), ('Salice'), ('Sambuco'), ('Tarassaco'), ('Tiglio'), ('Timo'), ('Trifoglio'), ('Tulipano'),
('Verbena'), ('Zafferano'), ('Anemone'), ('Begonia'), ('Borragine'), ('Cactus'), ('Castagno'), ('Corniolo'), ('Dragoncello'), ('Eucalipto'),
('Faggio'), ('Fiordaliso'), ('Fresia'), ('Gardenia'), ('Gerbera'), ('Giacinto'), ('Giaggiolo'), ('Gladiolo'), ('Ligustro'), ('Loto'),
('Maggiorana'), ('Mandorlo'), ('Nasturzio'), ('Ninfea'), ('Orchidea'), ('Peonia'), ('Primula'), ('Ranuncolo'), ('Rucola'), ('Sedano'),
('Sequoia'), ('Vischio'), ('Zinnia'), ('Azalea'), ('Bucaneve'), ('Caprifoglio'), ('Cardo'), ('Elicriso'), ('Equiseto'), ('Genziana');

create function public.checkin_incontro(p_porta uuid, p_persona uuid) returns text
  language plpgsql set search_path = '' as $$
declare
  v_prima constant integer := 30;
  v_dopo constant integer := 30;
  v_porta public.porte;
  v_i public.incontri;
  v_sono_a boolean;
  v_segnale text;
begin
  select * into v_porta from public.porte where id = p_porta for update;
  if not found or p_persona is null or p_persona not in (v_porta.a, v_porta.b) then
    return 'non_nella_porta';
  end if;
  v_sono_a := p_persona = v_porta.a;
  if not exists (select 1 from public.incontri where porta_id = p_porta) then
    return 'nessun_incontro';
  end if;
  v_i := public.incontro_aggiornato(p_porta);
  if v_i.esito = 'avvenuto' then
    return 'avvenuto';
  elsif v_i.esito is not null then
    return 'incontro_chiuso';
  elsif v_i.stato <> 'confermato' then
    return 'non_confermato';
  end if;
  if (v_sono_a and v_i.checkin_a_il is not null) or (not v_sono_a and v_i.checkin_b_il is not null) then
    return 'gia_fatto';
  end if;
  if now() < v_i.orario - make_interval(mins => v_prima) then
    return 'troppo_presto';
  end if;
  if now() >= v_i.orario + make_interval(mins => v_dopo + v_i.ritardo_minuti) then
    return 'troppo_tardi';
  end if;

  if v_sono_a then
    update public.incontri set checkin_a_il = now() where porta_id = p_porta returning * into v_i;
  else
    update public.incontri set checkin_b_il = now() where porta_id = p_porta returning * into v_i;
  end if;
  if v_i.checkin_a_il is null or v_i.checkin_b_il is null then
    return 'sono_qui';
  end if;
  -- Tutti e due: il segnale (a caso dalla lista), incontro avvenuto, caparre sbloccate subito.
  select parola into v_segnale from public.parole_segnale order by random() limit 1;
  update public.incontri set segnale = v_segnale, stato = 'concluso', esito = 'avvenuto', esito_il = now()
    where porta_id = p_porta;
  perform public.restituisci_caparre(p_porta);
  return 'avvenuto';
end $$;

revoke all on function public.checkin_incontro(uuid, uuid) from public, anon, authenticated;
grant execute on function public.checkin_incontro(uuid, uuid) to service_role;
