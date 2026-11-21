-- Owner decisions, 21 Nov 2026:
--   1. The person chooses the gap before each follow-up comment (instead of always 15 to 60 seconds).
--   2. A LinkedIn post can carry a video or a document (PDF, PowerPoint, Word; a PDF shows as a
--      swipeable carousel), not only images. LinkedIn allows images, OR one video, OR one document.
-- Run in the Supabase SQL Editor after 0019. Safe to run more than once.

-- ---------- 1. gap before each comment ----------
-- Seconds to wait after the post (first comment) or after the previous comment. Empty = random 15 to 60.
alter table public.post_comments add column if not exists gap_seconds int;
alter table public.post_comments drop constraint if exists post_comments_gap_seconds_check;
alter table public.post_comments add constraint post_comments_gap_seconds_check
  check (gap_seconds is null or gap_seconds between 15 and 3600);
grant update (gap_seconds) on public.post_comments to authenticated;

create or replace function public.queue_post_comments(p_post_id uuid)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_status text;
  v_external text;
  v_at timestamptz;
  v_gap int;
  v_last int := 0;
  v_count int := 0;
  r record;
begin
  select user_id, status, external_id into v_owner, v_status, v_external from public.posts where id = p_post_id;
  if v_owner is null then return 0; end if;
  if coalesce((select auth.role()), '') <> 'service_role' and v_owner is distinct from (select auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_status <> 'published' or v_external is null then return 0; end if;

  -- Carry on after any comment of this post that is already waiting.
  select greatest(now(), coalesce(max(due_at), now())) into v_at
    from public.post_comments where post_id = p_post_id and status in ('approved', 'publishing') and due_at is not null;

  perform set_config('hiba.queueing_comments', 'on', true);
  for r in
    select id, gap_seconds from public.post_comments
     where post_id = p_post_id and status = 'approved' and included and due_at is null
     order by position
     for update
  loop
    if r.gap_seconds is not null then
      v_gap := r.gap_seconds;
    else
      -- The owner's default: a random 15 to 60 seconds, never the same twice in a row.
      v_gap := 15 + floor(random() * 46)::int;
      if v_gap = v_last then v_gap := case when v_gap >= 59 then v_gap - 2 else v_gap + 2 end; end if;
    end if;
    v_last := v_gap;
    v_at := v_at + make_interval(secs => v_gap);
    update public.post_comments set due_at = v_at where id = r.id;
    v_count := v_count + 1;
  end loop;
  perform set_config('hiba.queueing_comments', '', true);
  return v_count;
end $$;
revoke all on function public.queue_post_comments(uuid) from public, anon;
grant execute on function public.queue_post_comments(uuid) to authenticated, service_role;

-- ---------- 2. video and document attachments ----------
-- Private bucket, one folder per person, like post-images. 50 MB is the largest file the
-- Supabase free plan accepts.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', false, 52428800, array[
  'video/mp4', 'video/quicktime',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'
])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "post_media_select_own" on storage.objects;
create policy "post_media_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "post_media_insert_own" on storage.objects;
create policy "post_media_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "post_media_delete_own" on storage.objects;
create policy "post_media_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- {"kind": "video" | "document", "path": "<uid>/<file>", "name": original file name,
--  "title": shown on LinkedIn (documents), "mime": type, "bytes": size}
alter table public.posts add column if not exists attachment jsonb;

create or replace function public.posts_check_attachment() returns trigger
language plpgsql set search_path = '' as $$
declare
  a jsonb := new.attachment;
begin
  if a is null then return new; end if;
  if jsonb_typeof(a) <> 'object' or (a ->> 'kind') not in ('video', 'document') then
    raise exception 'That attachment is not supported.' using errcode = 'check_violation';
  end if;
  if coalesce(a ->> 'path', '') = '' or split_part(a ->> 'path', '/', 1) <> new.user_id::text then
    raise exception 'That attachment is not supported.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(a ->> 'title', '')) > 200 or char_length(coalesce(a ->> 'name', '')) > 255 then
    raise exception 'The attachment title is too long.' using errcode = 'check_violation';
  end if;
  if new.platform <> 'linkedin' then
    raise exception 'Attachments are for LinkedIn posts only.' using errcode = 'check_violation';
  end if;
  -- LinkedIn: images, or one video, or one document. Never both.
  if coalesce(jsonb_array_length(case when jsonb_typeof(new.images) = 'array' then new.images end), 0) > 0
     or new.image_path is not null then
    raise exception 'A LinkedIn post can have images, or one video, or one document. Remove the images first.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists posts_check_attachment on public.posts;
create trigger posts_check_attachment before insert or update of attachment, images, image_path on public.posts
  for each row execute function public.posts_check_attachment();
