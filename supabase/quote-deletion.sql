begin;

grant delete on public.quote_requests to authenticated;

create policy admins_delete_quotes on public.quote_requests
    for delete to authenticated
    using ((select public.is_review_admin()));

commit;
