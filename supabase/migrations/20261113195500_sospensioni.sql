-- Fase 2 · issue #7 spec v1.1 (CPO, 30/10; D32 A, D51 A) · passo 4 della linea «sviluppatore-b».
-- Sospensione cautelare (1 sola segnalazione per minacce, minorenni, immagini diffuse: D51 A), sospensione automatica
-- (2 segnalazioni gravi da persone diverse in 30 giorni: D32) e coda degli avvisi al responsabile della sicurezza.
-- Le sospensioni le apre il server da solo; le toglie o le conferma SOLO una persona (pannello, passo successivo).
-- Gli avvisi qui sono solo una coda di riferimenti (nessun nome, email o racconto): chi li spedisce (email + push)
-- arriva in un passo successivo, quando Giuseppe avrà scelto il servizio. Tutto solo per il server.
-- Valori uguali a api/regole.js (MOTIVI_SOSPENSIONE_IMMEDIATA, SEGNALAZIONI) e api/segnalazioni.js (LIMITI):
-- test/sospensioni_database.test.mjs controlla che restino uguali.

create table public.sospensioni (
  id uuid primary key default gen_random_uuid(),
  -- Nessuna chiave verso auth.users: se la persona elimina l'account la sospensione resta nel registro.
  persona uuid not null,
  tipo text not null check (tipo in ('cautelare', 'automatica')),
  segnalazione_id uuid not null references public.segnalazioni (id),
  iniziata_il timestamptz not null default now(),
  rivedere_entro timestamptz not null,
  tolta_il timestamptz
);
-- Una sola sospensione attiva per persona.
create unique index sospensioni_attiva on public.sospensioni (persona) where tolta_il is null;

create table public.avvisi_sicurezza (
  id uuid primary key default gen_random_uuid(),
  segnalazione_id uuid references public.segnalazioni (id),
  sospensione_id uuid references public.sospensioni (id),
  -- nuova = segnalazione da 1 ora; non_aperta = nessuno l'ha aperta dopo 30 minuti; revisione_scaduta = 48 ore passate
  perche text not null check (perche in ('nuova', 'non_aperta', 'revisione_scaduta')),
  creato_il timestamptz not null default now(),
  inviato_il timestamptz,
  constraint riferimento check ((segnalazione_id is null) <> (sospensione_id is null))
);
create index avvisi_da_inviare on public.avvisi_sicurezza (creato_il) where inviato_il is null;
create index avvisi_segnalazione on public.avvisi_sicurezza (segnalazione_id, creato_il);
create index avvisi_sospensione on public.avvisi_sicurezza (sospensione_id, creato_il);

alter table public.sospensioni enable row level security;
alter table public.avvisi_sicurezza enable row level security;
revoke all on public.sospensioni, public.avvisi_sicurezza from public, anon, authenticated;
grant select, insert, update on public.sospensioni, public.avvisi_sicurezza to service_role;
-- Nessuna regola per authenticated: il telefono non legge e non scrive nulla qui.

-- La persona è sospesa adesso?
create function public.sospeso(p_persona uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sospensioni where persona = p_persona and tolta_il is null)
$$;
revoke all on function public.sospeso(uuid) from public, anon, authenticated;
grant execute on function public.sospeso(uuid) to service_role;

-- Dopo ogni nuova segnalazione: avviso al responsabile (priorità 1 ora), sospensione cautelare o automatica.
create function public.dopo_segnalazione() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  tipo text;
begin
  if public.ore_revisione(new.motivo) = 1 then
    insert into public.avvisi_sicurezza (segnalazione_id, perche) values (new.id, 'nuova');
  end if;
  if new.contro is null or public.sospeso(new.contro) then return null; end if;
  if new.motivo in ('minacce_pericolo', 'sembra_minorenne', 'diffusione_immagini') then
    tipo := 'cautelare';
  elsif public.ore_revisione(new.motivo) <= 24 and (
    -- D32: persone diverse, gravi (1 o 24 ore), non archiviate, negli ultimi 30 giorni.
    select count(distinct s.da) from public.segnalazioni s
    where s.contro = new.contro and public.ore_revisione(s.motivo) <= 24
      and s.esito is distinct from 'archiviata' and s.creata_il >= now() - interval '30 days') >= 2 then
    tipo := 'automatica';
  end if;
  if tipo is not null then
    insert into public.sospensioni (persona, tipo, segnalazione_id, rivedere_entro)
      values (new.contro, tipo, new.id, now() + interval '48 hours')
      on conflict (persona) where tolta_il is null do nothing;
  end if;
  return null;
end $$;
revoke all on function public.dopo_segnalazione() from public, anon, authenticated;
create trigger dopo_segnalazione after insert on public.segnalazioni
  for each row execute function public.dopo_segnalazione();

-- Avvisi da ripetere (li legge il lavoro che spedisce gli avvisi, che poi li mette in coda):
-- segnalazioni da 1 ora ancora chiuse e non aperte, con l'ultimo avviso di almeno 30 minuti fa;
-- sospensioni attive oltre le 48 ore, con l'ultimo avviso di revisione di almeno 12 ore fa (o nessuno).
create function public.avvisi_da_ripetere()
  returns table (segnalazione_id uuid, sospensione_id uuid, perche text)
  language sql stable security definer set search_path = '' as $$
  select s.id, null::uuid, 'non_aperta'
  from public.segnalazioni s
  where public.ore_revisione(s.motivo) = 1 and s.aperta_il is null and s.esito is null
    and (select max(a.creato_il) from public.avvisi_sicurezza a where a.segnalazione_id = s.id) <= now() - interval '30 minutes'
  union all
  select null::uuid, p.id, 'revisione_scaduta'
  from public.sospensioni p
  where p.tolta_il is null and p.rivedere_entro <= now()
    and not exists (select 1 from public.avvisi_sicurezza a where a.sospensione_id = p.id
      and a.perche = 'revisione_scaduta' and a.creato_il > now() - interval '12 hours')
$$;
revoke all on function public.avvisi_da_ripetere() from public, anon, authenticated;
grant execute on function public.avvisi_da_ripetere() to service_role;
