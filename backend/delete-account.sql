-- RISE：登入使用者自行永久刪除帳號
-- 請在 Supabase SQL Editor 執行本檔。
-- 函式沒有 user id 參數，只能刪除 JWT 所代表的目前登入者。

create or replace function public.rise_delete_my_account()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid := auth.uid();
  target_role text;
begin
  if target_user_id is null then
    raise exception 'rise:請先登入後再刪除帳號。'
      using errcode = '42501';
  end if;

  select role
    into target_role
    from public.rise_profiles
   where id = target_user_id;

  if target_role = 'admin' then
    raise exception 'rise:管理員帳號不可從會員中心自行刪除，請先確認仍有其他管理員，再由 Supabase 後台處理。'
      using errcode = '42501';
  end if;

  -- rise_profiles、rise_teacher_applications、rise_watch_history
  -- 已透過外鍵 on delete cascade 隨 auth.users 一併清除。
  delete from auth.users
   where id = target_user_id;

  if not found then
    raise exception 'rise:找不到目前登入帳號，可能已被刪除。'
      using errcode = 'P0002';
  end if;

  return true;
end;
$$;

revoke all
on function public.rise_delete_my_account()
from public, anon;

grant execute
on function public.rise_delete_my_account()
to authenticated;

comment on function public.rise_delete_my_account()
is 'Allows an authenticated non-admin user to permanently delete only their own RISE account.';
