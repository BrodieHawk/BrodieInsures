begin;

create schema if not exists review_private;

create table review_private.admins (
    user_id uuid primary key references auth.users (id) on delete cascade
);

alter table review_private.admins enable row level security;
revoke all on schema review_private from public, anon, authenticated;
revoke all on review_private.admins from public, anon, authenticated;

create table public.client_reviews (
    id uuid primary key default gen_random_uuid(),
    first_name text not null check (char_length(btrim(first_name)) between 1 and 60),
    last_name text not null check (char_length(btrim(last_name)) between 1 and 60),
    email text not null check (char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
    city text not null check (char_length(city) <= 80),
    rating smallint not null check (rating between 1 and 5),
    review text not null check (char_length(btrim(review)) between 1 and 2000),
    permission boolean not null check (permission),
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    submitted_at timestamptz not null default now()
);

create index on public.client_reviews (status, submitted_at desc);

alter table public.client_reviews enable row level security;
revoke all on public.client_reviews from public, anon, authenticated;
grant insert (first_name, last_name, email, city, rating, review, permission)
    on public.client_reviews to anon, authenticated;
grant select, update (status) on public.client_reviews to authenticated;

create function public.is_review_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
    select exists (select 1 from review_private.admins where user_id = auth.uid());
$$;

revoke all on function public.is_review_admin() from public, anon, authenticated;
grant execute on function public.is_review_admin() to authenticated;

create policy submit_pending_review on public.client_reviews
    for insert to anon, authenticated with check (status = 'pending' and permission);

create policy admins_read_reviews on public.client_reviews
    for select to authenticated using ((select public.is_review_admin()));

create policy admins_decide_pending_reviews on public.client_reviews
    for update to authenticated
    using (status = 'pending' and (select public.is_review_admin()))
    with check (status in ('approved', 'rejected') and (select public.is_review_admin()));

create function public.get_approved_reviews()
returns table (display_name text, city text, rating smallint, review text)
language sql stable security definer set search_path = ''
as $$
    select btrim(r.first_name) || ' ' || left(btrim(r.last_name), 1) || '.',
           r.city, r.rating, r.review
    from public.client_reviews r
    where r.status = 'approved'
    order by r.submitted_at desc, r.id desc;
$$;

revoke all on function public.get_approved_reviews() from public, anon, authenticated;
grant execute on function public.get_approved_reviews() to anon, authenticated;

commit;
