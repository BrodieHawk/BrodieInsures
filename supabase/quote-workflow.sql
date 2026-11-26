begin;

alter table public.quote_requests
    add column stage text not null default 'new'
        check (stage in ('new', 'contacted', 'quoting', 'quote_sent', 'won', 'closed')),
    add column admin_notes text not null default ''
        check (char_length(admin_notes) <= 4000),
    add column workflow_updated_at timestamptz not null default now();

create index on public.quote_requests (stage, submitted_at desc, id desc);

grant update (stage, admin_notes) on public.quote_requests to authenticated;
create policy admins_update_quote_workflow on public.quote_requests
    for update to authenticated
    using ((select public.is_review_admin()))
    with check ((select public.is_review_admin()));

create function review_private.stamp_quote_workflow()
returns trigger language plpgsql set search_path = ''
as $$
begin
    new.workflow_updated_at := clock_timestamp();
    return new;
end;
$$;

create trigger stamp_quote_workflow before update of stage, admin_notes on public.quote_requests
    for each row execute function review_private.stamp_quote_workflow();

commit;
