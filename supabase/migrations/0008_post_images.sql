-- Images on posts (HPD-60 attach, HPD-109 secure storage, HPD-111 LinkedIn media).
-- Run in the Supabase SQL editor after 0007.

-- Private bucket: files are never public; only the owner can read them (and the server
-- function acting as the owner, when it sends the image to LinkedIn).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', false, 5242880, array['image/jpeg', 'image/png', 'image/gif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Each person may only use their own folder: post-images/<their user id>/<file>.
drop policy if exists "post_images_select_own" on storage.objects;
create policy "post_images_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'post-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "post_images_insert_own" on storage.objects;
create policy "post_images_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'post-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "post_images_delete_own" on storage.objects;
create policy "post_images_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'post-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Which image a post uses, and its description for people using screen readers.
alter table public.posts add column if not exists image_path text
  check (image_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$');
alter table public.posts add column if not exists image_alt text check (char_length(image_alt) <= 300);

-- A post may only point at an image in its owner's own folder.
create or replace function public.posts_check_image_owner() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.image_path is not null and split_part(new.image_path, '/', 1) <> new.user_id::text then
    raise exception 'image does not belong to this user';
  end if;
  return new;
end $$;

drop trigger if exists posts_check_image_owner on public.posts;
create trigger posts_check_image_owner before insert or update of image_path on public.posts
  for each row execute function public.posts_check_image_owner();
