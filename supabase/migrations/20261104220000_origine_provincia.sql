-- Richiesta CISO del 3/11 (bassa): «provincia_origine» la scrive solo il server.
-- Prima il telefono poteva mandare «lista» alla prima scelta. Ora dal telefono è sempre «scelta»;
-- «lista» la potrà scrivere solo la futura funzione di precompilazione dalla lista d'attesa (#2), che prima di
-- scrivere imposta per la sola transazione presente.origine = 'lista' con set_config(..., true).
-- set_config non è esposta dall'API del telefono (schema pg_catalog), quindi il telefono non può imitarla.
-- Il resto della funzione è identico alla migrazione 20261103120000_provincia.sql.
create or replace function public.controlla_provincia() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  vecchia text := case when tg_op = 'UPDATE' then old.provincia end;
  prossimo timestamptz;
begin
  if new.provincia is distinct from vecchia then
    if new.provincia is null then
      raise exception 'La provincia non si può togliere.' using errcode = 'check_violation';
    end if;
    if vecchia is not null and old.provincia_cambiata_il > now() - interval '7 days' then
      prossimo := old.provincia_cambiata_il + interval '7 days';
      raise exception 'Puoi cambiarla di nuovo dal %.', to_char(prossimo at time zone 'Europe/Rome', 'DD/MM')
        using errcode = 'check_violation';
    end if;
    select p.regione into new.regione from public.province p where p.sigla = new.provincia;
    new.provincia_cambiata_il := now();
    new.provincia_precedente := vecchia;
    new.provincia_in_vigore_dal := case when vecchia is null then now() else public.prossima_apertura(now()) end;
    -- Origine dal server, mai dal telefono.
    new.provincia_origine := case when coalesce(current_setting('presente.origine', true), '') = 'lista' then 'lista' else 'scelta' end;
    new.citta := case when new.provincia = 'EE' then null else (select p.nome from public.province p where p.sigla = new.provincia) end;
  elsif tg_op = 'UPDATE' then
    new.regione := old.regione;
    new.provincia_origine := old.provincia_origine;
    new.provincia_cambiata_il := old.provincia_cambiata_il;
    new.provincia_precedente := old.provincia_precedente;
    new.provincia_in_vigore_dal := old.provincia_in_vigore_dal;
    if old.provincia is not null then new.citta := old.citta; end if;
  else
    new.regione := null; new.provincia_origine := null; new.provincia_cambiata_il := null;
    new.provincia_precedente := null; new.provincia_in_vigore_dal := null;
  end if;
  if new.provincia is null and new.passo > 5 and (tg_op = 'INSERT' or new.passo > old.passo) then
    raise exception 'Prima scegli la tua provincia.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.controlla_provincia() from public, anon, authenticated;
