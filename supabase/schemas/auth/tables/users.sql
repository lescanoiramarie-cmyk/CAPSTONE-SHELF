CREATE TRIGGER on_auth_user_visitor_confirm
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.link_visitor_auth_user();

CREATE TRIGGER on_auth_user_visitor_domain_validate
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_visitor_email_domain();

CREATE TRIGGER on_auth_user_visitor_link_insert
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.link_visitor_auth_user();
