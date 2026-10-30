-- The group-wide PINGO AI personality is gone: each member's own lives on
-- `conversation_members.ai_personality` (20261118000001), and ai-chat no
-- longer reads this column.
alter table public.conversations drop constraint if exists conversations_ai_personality;
alter table public.conversations drop column if exists ai_personality;
