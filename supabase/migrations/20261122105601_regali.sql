-- Fase 2 · issue #331 spec v1 (CPO, 21/11), parte C · D145 A · linea «sviluppatore-c» (passo 3).
-- Regali nelle stanze: rosa 5, bicchiere di spumante 10, mazzo di fiori 20 Coin a chi manda; chi riceve NON riceve
-- Coin (regola D9 «Niente affari»). In beta i Coin sono un contatore interno di prova: nessun pagamento.
-- Il server ricontrolla tutte le regole della spec (le stesse di regaloPermesso() in api/coin.js): così nemmeno una
-- chiamata diretta all'API può aggirarle. I regali non entrano negli algoritmi (suggerimenti, stanze, chiavi):
-- nessuna funzione di quei moduli legge questa tabella.
--
-- Scelte tecniche (nessun SQL distruttivo, nessuna riga del registro modificata o cancellata):
-- 1. Tabella «regali» con RLS attiva e nessuna regola per il telefono: legge e scrive solo il server.
-- 2. Ogni regalo ha un movimento «regalo» nel registro (−5/−10/−20). Il collegamento va dal regalo al movimento:
--    se chi riceve elimina l'account sparisce solo il regalo, i Coin di chi l'ha mandato restano scalati
--    (un regalo non si rimborsa); se chi manda elimina l'account sparisce tutto, come gli altri suoi movimenti.
-- 3. Doppio tocco su «Manda»: la richiesta porta una chiave unica (da, chiave); la stessa chiave non scala due volte.
-- 4. I limiti (3 al giorno alla stessa persona, 10 al giorno) contano il giorno di Roma.
-- 5. importi_previsti si ri-aggiunge «not valid» (vedi l'avvertenza in 20261121205606_coin_registro.sql).
-- 6. I codici di rifiuto restano distinti per i test; l'API manda al telefono solo il testo della spec
--    («Non puoi mandare regali a questa persona.»), così chi è bloccato o segnalato non lo scopre.

create function public.coin_regalo(p_regalo text) returns integer language sql immutable set search_path = '' as $$
  select case p_regalo when 'rosa' then 5 when 'spumante' then 10 when 'fiori' then 20 end
$$;

-- 1. Il movimento «regalo» nel registro.
alter table public.crediti_movimenti drop constraint crediti_movimenti_tipo_check;
alter table public.crediti_movimenti add constraint crediti_movimenti_tipo_check
  check (tipo in ('assegnati_beta', 'caparra_bloccata', 'caparra_restituita', 'stanza', 'buca_ricevuta', 'conversione_coin', 'regalo'));
alter table public.crediti_movimenti drop constraint importi_previsti;
alter table public.crediti_movimenti add constraint importi_previsti check (
  (tipo = 'assegnati_beta' and crediti between 10 and 5000 and porta_id is null)
  or (tipo = 'caparra_bloccata' and crediti = -100 and porta_id is not null)
  or (tipo = 'caparra_restituita' and crediti = 100 and porta_id is not null)
  or (tipo = 'stanza' and crediti = -80 and porta_id is null)
  or (tipo = 'buca_ricevuta' and crediti = 70 and porta_id is not null)
  or (tipo = 'regalo' and crediti in (-5, -10, -20) and porta_id is null)) not valid;

-- 2. I regali.
create table public.regali (
  id uuid primary key default gen_random_uuid(),
  chiave uuid not null,
  da uuid not null references auth.users (id) on delete cascade,
  a uuid not null references auth.users (id) on delete cascade,
  stanza_id uuid not null references public.stanze (id) on delete cascade,
  regalo text not null check (regalo in ('rosa', 'spumante', 'fiori')),
  coin integer not null,
  mandato_il timestamptz not null default now(),
  movimento_id bigint not null unique references public.crediti_movimenti (id) on delete cascade,
  constraint mai_a_se_stessi check (da <> a),
  constraint prezzo_del_regalo check (coin = public.coin_regalo(regalo)),
  constraint una_volta_per_chiave unique (da, chiave)
);
create index regali_da_giorno on public.regali (da, mandato_il);
create index regali_a on public.regali (a);
alter table public.regali enable row level security;
revoke all on table public.regali from public, anon, authenticated;
grant select, insert on table public.regali to service_role;

-- 3. Mandare un regalo. 'ok' oppure il motivo (gli stessi codici di regaloPermesso() in api/coin.js).
create function public.manda_regalo(p_da uuid, p_a uuid, p_regalo text, p_chiave uuid) returns text
  language plpgsql security definer set search_path = '' as $$
declare
  v_coin integer := public.coin_regalo(p_regalo);
  v_oggi constant timestamptz := date_trunc('day', now() at time zone 'Europe/Rome') at time zone 'Europe/Rome';
  s public.stanze;
  v_movimento bigint;
begin
  if v_coin is null then return 'regalo_sconosciuto'; end if;
  if p_da is null or p_a is null or p_chiave is null or p_da = p_a then return 'dati_mancanti'; end if;
  -- Un regalo alla volta per chi manda: due richieste insieme non superano i limiti né il saldo.
  perform pg_advisory_xact_lock(hashtextextended('crediti:' || p_da::text, 0));
  if exists (select 1 from public.regali r where r.da = p_da and r.chiave = p_chiave) then return 'ok'; end if;
  s := public.stanza_aperta_di(p_da);
  if s.id is null then return 'stanza_chiusa'; end if;
  if not exists (select 1 from public.membri_stanza m where m.stanza_id = s.id and m.utente_id = p_a) then
    return 'non_nella_stanza';
  end if;
  if not public.compatibili_tra(p_da, p_a) then return 'non_compatibile'; end if;
  if public.bloccati_tra(p_da, p_a) then return 'blocco'; end if;
  if exists (select 1 from public.segnalazioni g
             where (g.da = p_da and g.contro = p_a) or (g.da = p_a and g.contro = p_da)) then
    return 'segnalazione';
  end if;
  if public.sospeso(p_da) or public.sospeso(p_a) then return 'sospensione'; end if;
  if (select count(*) from public.regali r where r.da = p_da and r.a = p_a and r.mandato_il >= v_oggi) >= 3 then
    return 'limite_persona';
  end if;
  if (select count(*) from public.regali r where r.da = p_da and r.mandato_il >= v_oggi) >= 10 then
    return 'limite_giorno';
  end if;
  if public.saldo_crediti(p_da) < v_coin then return 'saldo'; end if;
  insert into public.crediti_movimenti (persona, tipo, crediti) values (p_da, 'regalo', -v_coin)
    returning id into v_movimento;
  insert into public.regali (chiave, da, a, stanza_id, regalo, coin, movimento_id)
    values (p_chiave, p_da, p_a, s.id, p_regalo, v_coin, v_movimento);
  return 'ok';
end $$;
revoke all on function public.manda_regalo(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.manda_regalo(uuid, uuid, text, uuid) to service_role;
