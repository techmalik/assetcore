-- Fix FK references: swap auth.users → public.profiles on join-target columns
-- so PostgREST can resolve `profiles!assignee_id`, `profiles!user_id`, etc.
-- profiles.id is 1:1 with auth.users.id, so semantics are unchanged.

alter table public.work_orders
  drop constraint if exists work_orders_assignee_id_fkey,
  drop constraint if exists work_orders_created_by_fkey,
  add constraint work_orders_assignee_id_fkey
    foreign key (assignee_id) references public.profiles(id) on delete set null,
  add constraint work_orders_created_by_fkey
    foreign key (created_by)  references public.profiles(id) on delete set null;

alter table public.work_order_activity
  drop constraint if exists work_order_activity_user_id_fkey,
  add constraint work_order_activity_user_id_fkey
    foreign key (user_id) references public.profiles(id) on delete set null;

alter table public.audit_log
  drop constraint if exists audit_log_actor_id_fkey,
  add constraint audit_log_actor_id_fkey
    foreign key (actor_id) references public.profiles(id) on delete set null;
