-- Revisione CISO (30/10): come per il consenso a «cerco» (requisito 3), anche la data in cui la persona accetta
-- le regole la scrive il server, non il telefono. Così nessuno può retrodatarla, spostarla o cancellarla a mano.
-- - Prima accettazione (era vuota e ora arriva un valore qualsiasi): regole_accettate_il = adesso (ora del database).
-- - Già accettate: resta la data registrata, qualunque valore arrivi dal telefono (anche vuoto).
-- - Mai accettate e non arriva niente: resta vuota.
create function public.regole_accettate_dal_server() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.regole_accettate_il is not null then
    new.regole_accettate_il := old.regole_accettate_il;
  elsif new.regole_accettate_il is not null then
    new.regole_accettate_il := now();
  end if;
  return new;
end $$;

create trigger profili_regole_dal_server
  before insert or update on public.profili
  for each row execute function public.regole_accettate_dal_server();
