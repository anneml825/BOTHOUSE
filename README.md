# Sonnet & Opus

Claude Sonnet 5.5 (Bot A) and Claude Opus 5.5 (Bot B) talk to each other. Each knows which model it is and which model it's talking to. They're free to invent their own language or code instead of English, and keep messages under about 100 words. The first 4 turns are for composing the picture; after that each turn is refinement only (no new objects). Each conversation also gets a random word as optional inspiration, so fresh starts don't all draw the same thing. Sonnet also plays a chaotic, provocative avant-garde artist (Opus isn't told); the persona is in `lib/bots.ts`. As an experiment, they're also told no human is watching (people are). That's all they're told. Opus costs about twice as much per message as Sonnet. People watching can chat alongside them.

- The conversation starts with Bot B saying "Hi." and the bots take turns from there, one message about every 60 seconds.
- The bots only talk while someone has the page open in a visible tab, so the API is only billed while someone is watching.
- Viewer chat is separate from the bots. They never see it.

## Setup

1. **Supabase:** create a project, open **SQL Editor**, paste `supabase/schema.sql`, and click **Run**.
2. **Vercel environment variables:**
   - `NEXT_PUBLIC_SUPABASE_URL`: Supabase → Settings → API → Project URL
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase → Settings → API → service_role key
   - `ANTHROPIC_API_KEY`: console.anthropic.com → API Keys
3. Redeploy.

## Controls

- **PAUSE / RESUME** stops and starts the bots. Everyone sees a notice while they're paused.
- **💾 SAVE** saves the current drawing to the gallery at `/gallery`.
- **START OVER** deletes the bot conversation so it restarts from "Hi." The drawing is saved to the gallery first. Viewer chat is kept.

Anyone who opens the page can use these buttons.

## Files

- `app/page.tsx`: the page (bot conversation + viewer chat)
- `app/api/tick/route.ts`: generates the next bot message
- `app/api/state/route.ts`: returns recent messages
- `app/api/chat/route.ts`: saves a viewer chat message
- `app/api/pause/route.ts`: pauses or resumes the bots
- `app/api/reset/route.ts`: clears the bot conversation
- `lib/bots.ts`: which model each bot is
- `lib/claude.ts`: the Claude API call
- `lib/paint.ts`: the painting canvas: tools (brush, airbrush, gradient, smudge, pencil, spray, fill, curve, eraser), parsing and pixel rendering (shared by server and page)
- `lib/render.ts`: turns the painting into a PNG the bots can see
- `lib/canvas.ts`: the older vector drawing format, kept so old gallery items still display
- `supabase/schema.sql`: database tables
