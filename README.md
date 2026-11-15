# PromptChamp

PromptChamp runs team image-prompt challenges for the monthly office IT Connect event.

Teams register, choose a lucky number, wait for the host to call them, then start a 2- or 3-minute challenge. Everyone sees the same reference image. An accepted prompt queues image generation and visual-match judging; the host publishes the final leaderboard after all turns and results are resolved.

## Run locally on Windows

Install Node.js 22 or later. In PowerShell:

```powershell
cd D:\Projects\PromptMatchCup
npm.cmd ci
npm.cmd run dev
```

Create `.env` from `.env.example` and configure the server-side credentials. Run `npm.cmd run migrate` for a new database. The development server starts a database-backed AI worker automatically when credentials are configured. Never commit `.env`.

- `/` - open office events
- `/admin.html` - private host sign-in and event controls
- `/event.html?event=your-event-slug` - team registration and timed challenge
- `/leaderboard.html?event=your-event-slug` - final result presentation
- `/demo.html` - original offline demo

## Host an event

Create a draft event, set its team capacity and timer, upload a private reference, and open registration. Share the displayed team link. After every team picks a number, lock the draw and call teams in order. Each team's timer starts only when it presses Start. Refreshing and device recovery preserve its deadline.

One prompt submission is final. Expired drafts are not automatically entered. Image generation and judging run after prompt acceptance without using the team's writing time. Matching uses five categories with weights 30/25/20/15/10 and returns a score out of 100. It is an AI assessment, not an exact pixel similarity measurement. Equal scores share a rank.

Scoring failures can reuse the stored image. Uncertain generation calls require a host decision rather than blind retries. A generation safety cap protects API quota. Final publication is blocked until all turns and failed/pending results are resolved.

## Deployment and data

[Deployment guide](docs/deployment.md) covers GitHub, hosting configuration, required environment variables, background processing, and live checks. The `promptchamp` database schema is separate from the original competition tables. Supabase Postgres holds event data and private images. Generated result images expire after 30 days; prompts and scores remain.

[Host setup](docs/host-setup.md) documents registration and queue controls. [Event design](docs/office-event-design.md) records the larger architecture and future enhancements. Private object storage, individual host accounts, and corporate sign-in are future improvements.

For sequential play against the same image, keep active screens away from waiting teams and avoid projecting the reference or prompts before everyone has finished.

