-- F9 lead form — one-time setup. Run this ONCE in the Supabase
-- dashboard (SQL editor) for the flipbook-reference / Manuazine project.
-- It creates a leads table + a submit_lead RPC. Anonymous readers can
-- submit a lead through the RPC only (they cannot read or write the
-- table directly); owners can read leads for their own flipbooks.
-- The Settings page shows "Leads need a one-time setup" until this runs.

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  flipbook_id uuid not null references public.flipbooks(id) on delete cascade,
  name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

alter table public.leads enable row level security;

drop policy if exists "Owners can read their leads" on public.leads;
create policy "Owners can read their leads"
  on public.leads for select
  using (
    exists (
      select 1 from public.flipbooks f
      where f.id = leads.flipbook_id
        and f.user_id = auth.uid()
    )
  );

-- SECURITY DEFINER so anonymous readers can insert a lead without
-- direct table access. Validates the flipbook exists and is public.
create or replace function public.submit_lead(
  p_flipbook_id uuid,
  p_name text,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'name is required';
  end if;
  if p_email is null or btrim(p_email) = '' then
    raise exception 'email is required';
  end if;
  if not exists (
    select 1 from public.flipbooks
    where id = p_flipbook_id and is_public = true
  ) then
    raise exception 'flipbook not found';
  end if;
  insert into public.leads (flipbook_id, name, email)
  values (p_flipbook_id, btrim(p_name), btrim(p_email))
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.submit_lead(uuid, text, text) to anon, authenticated;
