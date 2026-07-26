-- PINGO — sticker messages.
--
-- A sticker is a message, not an attachment on one. It has no caption, it
-- renders without a bubble, and it is the entire content — so it gets a `kind`
-- rather than being squeezed into the text column.
--
-- `body` stays required and carries the sticker's emoji or name. That is
-- deliberate: it means a sticker degrades to something readable anywhere the
-- image cannot be shown — a notification preview, the conversation list, a
-- screen reader, or a future client that predates stickers.

alter table public.messages
  add column if not exists kind text not null default 'text';

alter table public.messages
  add column if not exists media_url text;

do $$
begin
  alter table public.messages
    add constraint messages_kind_check check (kind in ('text', 'sticker'));
exception
  when duplicate_object then null;
end;
$$;

-- A sticker without its image is not a sticker.
do $$
begin
  alter table public.messages
    add constraint messages_sticker_needs_media
    check (kind <> 'sticker' or media_url is not null);
exception
  when duplicate_object then null;
end;
$$;
