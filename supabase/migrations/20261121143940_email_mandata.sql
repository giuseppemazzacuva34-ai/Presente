-- Fase 2 · issue #7 spec v1.3 (CPO, 21/11) · decisione D144 A di Giuseppe. Linea «sviluppatore-b», passo 15d.
-- Il pannello segna «Email mandata» solo quando chi ha deciso tocca «Ho mandato l'email»: qui si salvano data e ora.
-- segna_email_mandata(moderatore, sanzione) salva now() la prima volta (un secondo tocco non la cambia) e restituisce
-- la data salvata; email_mandata(moderatore, sanzione) la rilegge. Solo a un moderatore e solo per una sanzione decisa
-- da lui (come email_sanzione), altrimenti null. Nessun invio, nessun servizio esterno. Solo server. Solo aggiunte.
alter table public.sanzioni add column email_mandata_il timestamptz;

create function public.segna_email_mandata(p_moderatore uuid, p_sanzione uuid) returns timestamptz
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_quando timestamptz;
begin
  if not public.e_moderatore(p_moderatore) then return null; end if;
  update public.sanzioni set email_mandata_il = coalesce(email_mandata_il, now())
  where id = p_sanzione and decisa_da = p_moderatore
  returning email_mandata_il into v_quando;
  return v_quando;
end $$;
revoke all on function public.segna_email_mandata(uuid, uuid) from public, anon, authenticated;
grant execute on function public.segna_email_mandata(uuid, uuid) to service_role;

create function public.email_mandata(p_moderatore uuid, p_sanzione uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select z.email_mandata_il from public.sanzioni z
  where z.id = p_sanzione and z.decisa_da = p_moderatore and public.e_moderatore(p_moderatore)
$$;
revoke all on function public.email_mandata(uuid, uuid) from public, anon, authenticated;
grant execute on function public.email_mandata(uuid, uuid) to service_role;
