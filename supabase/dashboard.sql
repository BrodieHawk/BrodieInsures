begin;

create extension if not exists pg_net with schema extensions;

alter table public.client_reviews alter column email drop not null;
alter table public.client_reviews drop constraint client_reviews_status_check;
alter table public.client_reviews add check (status in ('pending', 'approved', 'rejected', 'removed'));

drop policy submit_pending_review on public.client_reviews;
create policy submit_pending_review on public.client_reviews for insert to anon, authenticated
    with check (status = 'pending' and permission and email is not null);

drop policy admins_decide_pending_reviews on public.client_reviews;
create policy admins_moderate_reviews on public.client_reviews for update to authenticated
    using (status <> 'removed' and (select public.is_review_admin()))
    with check (status in ('approved', 'rejected', 'removed') and (select public.is_review_admin()));

create table public.quote_requests (
    id uuid primary key default gen_random_uuid(),
    coverage text not null check (coverage in ('Homeowners', 'Auto', 'Rental', 'Umbrella', 'Business')),
    first_name text not null check (char_length(btrim(first_name)) between 1 and 60),
    last_name text not null check (char_length(btrim(last_name)) between 1 and 60),
    email text not null check (char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
    phone text not null check (char_length(phone) <= 40),
    property_address text not null check (char_length(property_address) <= 250),
    message text not null check (char_length(message) <= 2000),
    submitted_at timestamptz not null default now(),
    check ((coverage = 'Homeowners' and btrim(property_address) <> '') or
           (coverage <> 'Homeowners' and property_address = ''))
);
create index on public.quote_requests (submitted_at desc, id desc);

alter table public.quote_requests enable row level security;
revoke all on public.quote_requests from public, anon, authenticated;
grant insert (coverage, first_name, last_name, email, phone, property_address, message)
    on public.quote_requests to anon, authenticated;
grant select on public.quote_requests to authenticated;
create policy submit_quote_request on public.quote_requests for insert to anon, authenticated
    with check (true);
create policy admins_read_quotes on public.quote_requests for select to authenticated
    using ((select public.is_review_admin()));

-- Import the testimonials previously maintained in HTML before enabling notifications.
insert into public.client_reviews (first_name, last_name, city, review, rating, permission, status, submitted_at) values
    ('Colby', 'V', 'Auburn', 'Getting auto insurance for my truck through Brodie Insurance was easy and hassle-free. The entire process went smoothly, and his professionalism and customer service were excellent. He were helpful, responsive, and made sure everything was taken care of without making things complicated. I really appreciated how easy Brodie made it to get insured. Anyone looking for a professional and straightforward insurance experience should definitely go with Brodie Insures', 5, true, 'approved', now() - interval '1 seconds'),
    ('Ryan', 'C', 'Roseville', 'Brodie was great to work with. He helped me find a much better rate on my auto insurance and ended up saving me $150 a month compared to what I was paying before. The whole process was quick and easy and communication was great throughout the entire thing. It''s nice working with someone who actually takes the time to find you a good deal. I definitely recommend giving him a call if you''re looking to save on insurance', 5, true, 'approved', now() - interval '2 seconds'),
    ('Shaylie', 'P', '', 'I’ve had the opportunity to work with Brodie, and I can confidently say he’s one of the most reliable and knowledgeable insurance brokers you’ll come across. He takes his time to actually understand your situation instead of pushing generic policies, which makes a huge difference when you’re making important financial decisions.

What stands out most is his professionalism and attention to detail. He explains everything clearly, makes sure you know exactly what you’re getting, and always looks for the best possible coverage at a fair rate.

If you’re looking for someone who’s trustworthy, responsive, and knows the insurance space inside and out, I’d highly recommend working with him.', 5, true, 'approved', now() - interval '3 seconds');

create function public.get_published_testimonials()
returns table (display_name text, city text, rating smallint, review text)
language sql stable security definer set search_path = ''
as $$
    select * from public.get_approved_reviews();
$$;
revoke all on function public.get_published_testimonials() from public, anon, authenticated;
grant execute on function public.get_published_testimonials() to anon, authenticated;

create function public.quote_dashboard_ready()
returns boolean language sql stable security definer set search_path = ''
as $$
    select count(distinct name) = 3
    from vault.decrypted_secrets
    where name in ('brodie_resend_api_key', 'brodie_email_from', 'brodie_email_to')
      and nullif(btrim(decrypted_secret), '') is not null;
$$;
revoke all on function public.quote_dashboard_ready() from public, anon, authenticated;
grant execute on function public.quote_dashboard_ready() to anon, authenticated;

create function review_private.notify_submission()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
    api_key text;
    sender text;
    recipient text;
    subject text;
    message text;
begin
    select max(decrypted_secret) filter (where name = 'brodie_resend_api_key'),
           max(decrypted_secret) filter (where name = 'brodie_email_from'),
           max(decrypted_secret) filter (where name = 'brodie_email_to')
    into api_key, sender, recipient
    from vault.decrypted_secrets
    where name in ('brodie_resend_api_key', 'brodie_email_from', 'brodie_email_to');

    if nullif(api_key, '') is null or nullif(sender, '') is null or nullif(recipient, '') is null then
        return new;
    end if;

    if tg_table_name = 'client_reviews' then
        subject := 'BrodieInsures review awaiting approval';
        message := format('A new %s-star review from %s is waiting in Review Admin.',
            new.rating, new.first_name);
    else
        subject := 'BrodieInsures quote request';
        message := format(E'Coverage: %s\nName: %s %s\nEmail: %s\nPhone: %s\nProperty address: %s\n\nMessage:\n%s',
            new.coverage, new.first_name, new.last_name, new.email, new.phone,
            new.property_address, new.message);
    end if;

    perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization', 'Bearer ' || api_key,
            'Content-Type', 'application/json', 'Idempotency-Key', tg_table_name || '/' || new.id),
        body := jsonb_build_object('from', sender, 'to', jsonb_build_array(recipient),
            'subject', subject, 'text', message)
    );
    return new;
exception when others then
    raise warning 'Could not enqueue submission email for % row % (SQLSTATE %)', tg_table_name, new.id, sqlstate;
    return new;
end;
$$;
revoke all on function review_private.notify_submission() from public, anon, authenticated;

create trigger notify_new_review after insert on public.client_reviews
    for each row when (new.status = 'pending') execute function review_private.notify_submission();
create trigger notify_new_quote after insert on public.quote_requests
    for each row execute function review_private.notify_submission();

commit;
