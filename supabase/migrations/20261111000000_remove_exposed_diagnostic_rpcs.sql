drop function if exists public.diag_visitor_row(text);
drop function if exists public.diag_list_community_rpcs();

notify pgrst, 'reload schema';
