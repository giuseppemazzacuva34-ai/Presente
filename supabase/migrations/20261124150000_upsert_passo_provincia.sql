-- Segnalazione di Giuseppe (24/11, primo accesso da tester): al passo «Chi cerchi» compariva «Prima scegli la tua
-- provincia» anche con la provincia già salvata. L'app salva il passo con un upsert: Postgres esegue il trigger
-- «before insert» sulla riga proposta (solo id e passo) prima di accorgersi che la riga esiste, e la regola la
-- rifiutava. Ora, se la riga esiste già, il controllo lo fa solo il «before update» sulla riga vera.
-- La regola non cambia: senza provincia salvata non si va oltre il passo 5. Test: supabase/test/prova_passo_dopo_provincia.sql.
-- Il resto della funzione è identico a 20261104220000_origine_provincia.sql.
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
  -- Upsert dell'app (insert … on conflict do update): il «before insert» gira anche quando la riga esiste già, sulla
  -- riga proposta che ha solo i campi mandati. Se la riga c'è, decide il «before update» con la provincia salvata.
  if new.provincia is null and new.passo > 5
     and ((tg_op = 'INSERT' and not exists (select 1 from public.profili p where p.id = new.id))
          or (tg_op = 'UPDATE' and new.passo > old.passo)) then
    raise exception 'Prima scegli la tua provincia.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.controlla_provincia() from public, anon, authenticated;
