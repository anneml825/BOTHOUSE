-- =============================================
-- BOT HOUSE - Anonymous Chat Support
-- Removes the auth requirement from viewer chat
-- so anyone can message without an account.
-- Run AFTER 002_seed_data.sql
-- =============================================

-- Make user_id nullable so anonymous viewers can chat
alter table viewer_messages
  alter column user_id drop not null;

-- Drop the old policy that required auth.uid() = user_id
drop policy if exists "viewer_messages_auth_insert" on viewer_messages;

-- Anyone can insert a message (no account needed)
create policy "viewer_messages_public_insert" on viewer_messages
  for insert with check (true);
