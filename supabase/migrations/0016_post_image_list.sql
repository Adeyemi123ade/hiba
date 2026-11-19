-- Several images on one LinkedIn post (up to 9), posted together as one multi-image post.
-- Run in the Supabase SQL editor after 0015.
--
-- posts.images is the list, in order: [{"path": "<user id>/<file>", "alt": "description or null"}, ...]
-- The first image is mirrored into posts.image_path / image_alt, so the Posts page thumbnail,
-- search and anything else that reads the single-image columns keep working.
-- An older copy of the app that still writes image_path / image_alt directly is also understood.

alter table public.posts add column if not exists images jsonb not null default '[]'::jsonb;

create or replace function public.posts_sync_images() returns trigger
language plpgsql set search_path = '' as $$
declare
  item jsonb;
  n int;
begin
  -- An older app changed only the single-image columns: rebuild the list from them.
  if tg_op = 'UPDATE' and new.images is not distinct from old.images
     and (new.image_path is distinct from old.image_path or new.image_alt is distinct from old.image_alt) then
    if new.image_path is null then
      new.images := case when jsonb_array_length(old.images) > 1 then old.images - 0 else '[]'::jsonb end;
    elsif jsonb_array_length(old.images) = 0 then
      new.images := jsonb_build_array(jsonb_build_object('path', new.image_path, 'alt', new.image_alt));
    else
      new.images := jsonb_set(old.images, '{0}', jsonb_build_object('path', new.image_path, 'alt', new.image_alt));
    end if;
  end if;

  if new.images is null or jsonb_typeof(new.images) <> 'array' then
    raise exception 'images must be a list' using errcode = 'check_violation';
  end if;
  n := jsonb_array_length(new.images);
  if n > 9 then
    raise exception 'A post can have at most 9 images' using errcode = 'check_violation';
  end if;
  for item in select value from jsonb_array_elements(new.images) loop
    if jsonb_typeof(item) <> 'object' or jsonb_typeof(item -> 'path') is distinct from 'string'
       or (item ->> 'path') !~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$' then
      raise exception 'invalid image entry' using errcode = 'check_violation';
    end if;
    if split_part(item ->> 'path', '/', 1) <> new.user_id::text then
      raise exception 'image does not belong to this user' using errcode = 'check_violation';
    end if;
    if coalesce(jsonb_typeof(item -> 'alt'), 'null') not in ('string', 'null')
       or char_length(coalesce(item ->> 'alt', '')) > 300 then
      raise exception 'invalid image description' using errcode = 'check_violation';
    end if;
  end loop;
  if (select count(distinct value ->> 'path') from jsonb_array_elements(new.images)) <> n then
    raise exception 'the same image is on the post twice' using errcode = 'check_violation';
  end if;

  new.image_path := new.images -> 0 ->> 'path';
  new.image_alt := nullif(new.images -> 0 ->> 'alt', '');
  return new;
end $$;

drop trigger if exists posts_sync_images on public.posts;
create trigger posts_sync_images before insert or update of images, image_path, image_alt on public.posts
  for each row execute function public.posts_sync_images();

-- Existing single images become a list of one.
update public.posts
   set images = jsonb_build_array(jsonb_build_object('path', image_path, 'alt', image_alt))
 where image_path is not null and images = '[]'::jsonb;
