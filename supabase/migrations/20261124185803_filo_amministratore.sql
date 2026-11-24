-- Fase 2 · issue #360 «Il Filo della stanza», spec v1 + v1.1 del CPO (22-23/11, D151 A) · passo 12a della linea
-- «sviluppatore-c»: il pannello dell'amministratore per il Filo, parte del database.
--   · stanze_filo_amministratore: le stanze composte e non chiuse, con il nome di battesimo del Filo (se c'è), quanti
--     membri, quali vocali ci sono e l'avviso del lunedì: «manca_lunedi» se alle 8:45 (ora di Roma) il vocale non c'è
--     (il Filo può ancora caricarlo fino alle 13:00), «senza_lunedi» dopo le 13:00. Mai nomi dei membri, chiavi o altro.
--   · assegna_filo_stanza / togli_filo_stanza: l'amministratore indica il Filo con la sua email (account già esistente;
--     l'email non torna indietro né va nei log). Un Filo per stanza; un membro non può esserlo (trigger esistente).
--   · vocale_filo_amministratore: percorso, durata e testo di un vocale per ascoltarlo (il Worker fa il link firmato).
--   · togli_vocale_filo_amministratore: toglie un vocale inadatto solo se è ancora quello ascoltato; ogni rimozione
--     resta in vocali_filo_tolti. Il Worker cancella prima il file dal contenitore, poi la riga (niente file orfani).
-- Amministratore = tabella moderatori (in beta solo Giuseppe, D51 A). Tutto SOLO per il server (chiave del server).
-- Solo aggiunte: una tabella e cinque funzioni; ogni delete ha il filtro.

create table public.vocali_filo_tolti (
  id bigint generated always as identity primary key,
  stanza_id uuid not null references public.stanze (id) on delete cascade,
  tipo text not null check (tipo in ('lunedi', 'domenica')),
  tolto_da uuid not null,
  tolto_il timestamptz not null
);
create index vocali_filo_tolti_stanza on public.vocali_filo_tolti (stanza_id);
alter table public.vocali_filo_tolti enable row level security;
revoke all on public.vocali_filo_tolti from public, anon, authenticated, service_role;
grant select on public.vocali_filo_tolti to service_role;
-- Nessuna regola per authenticated: il telefono non legge il registro.

create function public.stanze_filo_amministratore(p_amministratore uuid, p_ora timestamptz)
  returns table (stanza uuid, nome text, citta text, apre_il timestamptz, chiude_il timestamptz, filo_nome text,
                 membri integer, vocale_lunedi boolean, vocale_domenica boolean, avviso text)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.e_moderatore(p_amministratore) then
    raise exception 'non_amministratore' using errcode = 'insufficient_privilege';
  end if;
  return query
    select s.id, s.nome, s.citta, s.apre_il, s.chiude_il,
      case when f.filo is null then null else coalesce((select pr.nome from public.profili pr where pr.id = f.filo), '') end,
      (select count(*)::integer from public.membri_stanza m where m.stanza_id = s.id),
      exists (select 1 from public.vocali_filo v where v.stanza_id = s.id and v.tipo = 'lunedi'),
      exists (select 1 from public.vocali_filo v where v.stanza_id = s.id and v.tipo = 'domenica'),
      case
        when f.filo is null or exists (select 1 from public.vocali_filo v where v.stanza_id = s.id and v.tipo = 'lunedi')
          then null
        when p_ora >= (((s.apre_il at time zone 'Europe/Rome')::date + time '13:00') at time zone 'Europe/Rome')
          then 'senza_lunedi'
        when p_ora >= (((s.apre_il at time zone 'Europe/Rome')::date + time '08:45') at time zone 'Europe/Rome')
          then 'manca_lunedi'
      end
    from public.stanze s left join public.fili_stanza f on f.stanza_id = s.id
    where p_ora is not null and s.creata_il <= p_ora and p_ora < s.chiude_il
    order by s.apre_il, s.citta nulls first, s.id;
end $$;
revoke all on function public.stanze_filo_amministratore(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.stanze_filo_amministratore(uuid, timestamptz) to service_role;

create function public.assegna_filo_stanza(p_amministratore uuid, p_stanza uuid, p_email text, p_ora timestamptz)
  returns void
  language plpgsql volatile security definer set search_path = '' as $$
declare
  persona uuid;
begin
  if not public.e_moderatore(p_amministratore) then
    raise exception 'non_amministratore' using errcode = 'insufficient_privilege';
  end if;
  if p_ora is null or not exists (select 1 from public.stanze s where s.id = p_stanza and p_ora < s.chiude_il) then
    raise exception 'stanza' using errcode = 'check_violation';
  end if;
  select u.id into persona from auth.users u where lower(u.email) = lower(btrim(coalesce(p_email, ''))) limit 1;
  if persona is null then
    raise exception 'persona' using errcode = 'check_violation';
  end if;
  insert into public.fili_stanza as fs (stanza_id, filo, assegnato_il) values (p_stanza, persona, p_ora)
    on conflict (stanza_id) do update set filo = excluded.filo, assegnato_il = excluded.assegnato_il;
end $$;
revoke all on function public.assegna_filo_stanza(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.assegna_filo_stanza(uuid, uuid, text, timestamptz) to service_role;

create function public.togli_filo_stanza(p_amministratore uuid, p_stanza uuid) returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
declare
  tolti integer;
begin
  if not public.e_moderatore(p_amministratore) then
    raise exception 'non_amministratore' using errcode = 'insufficient_privilege';
  end if;
  delete from public.fili_stanza f where f.stanza_id = p_stanza;
  get diagnostics tolti = row_count;
  return tolti > 0;
end $$;
revoke all on function public.togli_filo_stanza(uuid, uuid) from public, anon, authenticated;
grant execute on function public.togli_filo_stanza(uuid, uuid) to service_role;

create function public.vocale_filo_amministratore(p_amministratore uuid, p_stanza uuid, p_tipo text)
  returns table (file text, durata smallint, testo text)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.e_moderatore(p_amministratore) then
    raise exception 'non_amministratore' using errcode = 'insufficient_privilege';
  end if;
  return query
    select v.file, v.durata, v.testo from public.vocali_filo v where v.stanza_id = p_stanza and v.tipo = p_tipo;
end $$;
revoke all on function public.vocale_filo_amministratore(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.vocale_filo_amministratore(uuid, uuid, text) to service_role;

create function public.togli_vocale_filo_amministratore(p_amministratore uuid, p_stanza uuid, p_tipo text,
                                                        p_file text, p_ora timestamptz) returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
declare
  tolti integer;
begin
  if not public.e_moderatore(p_amministratore) then
    raise exception 'non_amministratore' using errcode = 'insufficient_privilege';
  end if;
  if p_ora is null then
    return false;
  end if;
  delete from public.vocali_filo v where v.stanza_id = p_stanza and v.tipo = p_tipo and v.file = p_file;
  get diagnostics tolti = row_count;
  if tolti > 0 then
    insert into public.vocali_filo_tolti (stanza_id, tipo, tolto_da, tolto_il) values (p_stanza, p_tipo, p_amministratore, p_ora);
  end if;
  return tolti > 0;
end $$;
revoke all on function public.togli_vocale_filo_amministratore(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.togli_vocale_filo_amministratore(uuid, uuid, text, text, timestamptz) to service_role;
