-- Test del mascheramento dei contatti per l'agente che prepara le bozze (issue #10, parte B v1 del CPO, 13/11).
-- Linea «sviluppatore-c». Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
-- Spec: prima di arrivare all'agente il server maschera nel testo email, numeri di 6+ cifre, link e nomi di social
-- (→ «[contatto nascosto]»). Il resto del testo resta uguale. Solo il server può usare la funzione.
\set ON_ERROR_STOP on
create function pg_temp.ok(condizione boolean, descrizione text) returns void language plpgsql as $$
begin
  if condizione is not true then raise exception 'ERRORE %', descrizione; end if;
  raise notice 'OK   %', descrizione;
end $$;
create function pg_temp.rifiutato(comando text) returns boolean language plpgsql as $$
begin
  execute comando;
  return false;
exception when others then
  return true;
end $$;

begin;
select pg_temp.ok(public.maschera_contatti('Scrivetemi a mario.rossi+test@example.com grazie')
  = 'Scrivetemi a [contatto nascosto] grazie', 'maschera: email');
select pg_temp.ok(public.maschera_contatti('il mio numero è +39 333 123 4567, chiamatemi')
  = 'il mio numero è [contatto nascosto], chiamatemi', 'maschera: telefono con spazi e prefisso');
select pg_temp.ok(public.maschera_contatti('codice 123456 non arriva') = 'codice [contatto nascosto] non arriva',
  'maschera: numero di 6 cifre');
select pg_temp.ok(public.maschera_contatti('ho 2 chiavi e 12345 crediti?') = 'ho 2 chiavi e 12345 crediti?',
  'maschera: numeri fino a 5 cifre restano');
select pg_temp.ok(public.maschera_contatti('guarda https://esempio.it/pagina?x=1 e www.esempio.com')
  = 'guarda [contatto nascosto] e [contatto nascosto]', 'maschera: link con e senza http');
select pg_temp.ok(public.maschera_contatti('scrivimi su t.me/mario_r oppure esempio.it')
  = 'scrivimi su [contatto nascosto] oppure [contatto nascosto]', 'maschera: link senza www');
select pg_temp.ok(public.maschera_contatti('seguimi su IG @mario.rossi_90!') = 'seguimi su IG [contatto nascosto]!',
  'maschera: nome social con @');
select pg_temp.ok(public.maschera_contatti('Non riesco a entrare nella stanza. Aiuto, grazie.')
  = 'Non riesco a entrare nella stanza. Aiuto, grazie.', 'maschera: testo senza contatti uguale');
select pg_temp.ok(public.maschera_contatti(null) is null, 'maschera: testo assente resta assente');
-- Solo il server: il telefono (authenticated) e chi non è entrato (anon) non chiamano la funzione.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select public.maschera_contatti('x')$$), 'maschera: authenticated non la chiama');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.rifiutato($$select public.maschera_contatti('x')$$), 'maschera: anon non la chiama');
reset role;
rollback;
