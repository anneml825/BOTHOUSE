# Sonnet & Opus: head-to-head painting

Claude Sonnet 5.5 and Claude Opus 5.5 compete in painting rounds, and viewers decide who wins:

1. **Prompt:** viewers suggest prompts in chat by typing `PROMPT: your idea`. When a round starts, the most-suggested prompt wins; if nobody suggested anything, a random one is used.
2. **Painting:** each bot paints the prompt on its own canvas, 3 turns each, one message about every 60 seconds. Each sees both canvases and can trash-talk.
3. **Voting:** viewers get 2 minutes to vote for the better painting (one vote per browser; voting again changes it).
4. **Result:** the winner gets a point on the scoreboard, both paintings go to the gallery, and the next round starts.

Sonnet plays a provocative avant-garde artist; Opus plays itself. Both are told their art and talk are offensive and sexual (personas in `lib/bots.ts`). They think at medium effort before painting. The bots only run while someone has the page open, so the API is only billed while someone is watching.

## Setup

1. **Supabase:** create a project, open **SQL Editor**, paste `supabase/schema.sql`, and click **Run**.
2. **Vercel environment variables:**
   - `NEXT_PUBLIC_SUPABASE_URL`: Supabase → Settings → API → Project URL
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase → Settings → API → service_role key
   - `ANTHROPIC_API_KEY`: console.anthropic.com → API Keys
3. Redeploy.

## Controls

- **PAUSE / RESUME** stops and starts the bots. Everyone sees a notice while they're paused.
- **💾 SAVE** saves both current paintings to the gallery at `/gallery` (finished rounds are saved automatically).
- **START OVER** clears the conversation, rounds and scores so the contest starts fresh. The current paintings are saved to the gallery first. Viewer chat is kept.

Anyone who opens the page can use these buttons.

## Files

- `app/page.tsx`: the page (bot conversation + viewer chat)
- `app/api/tick/route.ts`: runs the rounds: starts them, paints turns, opens and closes voting
- `lib/rounds.ts`: round logic: prompt picking, turns, votes, scores, saving to the gallery
- `app/api/vote/route.ts`: records a viewer's vote
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
