-- Fascia di disponibilità v1.3 e «Oggi non ricevo chiamate» (issue #4, spec v1.3 del CPO, 13/11, § 1).
-- Solo aggiunte: nessun dato cancellato. Le fasce già salvate restano come sono (vincolo NOT VALID): il server usa
-- 9:00–23:00 per ogni fascia vuota o non valida (api/chiamate.js), quindi nessuna riga va riscritta.

-- Minuti dalla mezzanotte di un orario «HH:MM» a passo di 30 minuti (da 00:00 a 24:00); null se non è valido.
create function public.minuti_fascia(ora text) returns integer language sql immutable as $$
  select case when ora ~ '^(([01][0-9]|2[0-3]):(00|30)|24:00)$'
    then split_part(ora, ':', 1)::integer * 60 + split_part(ora, ':', 2)::integer end
$$;
revoke all on function public.minuti_fascia(text) from public, anon;
grant execute on function public.minuti_fascia(text) to authenticated, service_role;

-- Default per i profili nuovi: tutti i giorni 9:00–23:00, senza che l'utente faccia nulla.
alter table public.profili alter column fascia_da set default '09:00', alter column fascia_a set default '23:00';

-- Regole nuove: passo di 30 minuti, «Alle» fino a 24:00, almeno 1 ora, fine dopo l'inizio (niente mezzanotte a cavallo).
alter table public.profili drop constraint if exists profili_fascia_da_check, drop constraint if exists profili_fascia_a_check;
alter table public.profili add constraint fascia_v13 check (
  (fascia_da is null and fascia_a is null)
  or (public.minuti_fascia(fascia_da) is not null and fascia_da <> '24:00' and public.minuti_fascia(fascia_a) is not null
      and public.minuti_fascia(fascia_a) - public.minuti_fascia(fascia_da) >= 60)
) not valid;

-- «Oggi non ricevo chiamate»: il giorno di Roma in cui è acceso. Vale fino alle 23:59 e poi si spegne da solo
-- (il server lo confronta con oggi). Si può accendere solo per oggi.
alter table public.profili add column pausa_il date;
comment on column public.profili.pausa_il is 'Giorno (ora di Roma) di «Oggi non ricevo chiamate». Solo oggi o null.';

create function public.controlla_pausa() returns trigger language plpgsql as $$
begin
  if new.pausa_il is not null and (tg_op = 'INSERT' or new.pausa_il is distinct from old.pausa_il)
     and new.pausa_il <> (now() at time zone 'Europe/Rome')::date then
    raise exception '«Oggi non ricevo chiamate» vale solo per oggi.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger controlla_pausa before insert or update of pausa_il on public.profili
  for each row execute function public.controlla_pausa();
