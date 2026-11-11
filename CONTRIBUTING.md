# Contributing to GitSpace

Thanks for helping. GitSpace exists to help people land their first open-source PR, so first-timers are very welcome here.

## Find something to work on

- Look for issues labelled [`good first issue`](https://github.com/ronaksarda/GitSpace/labels/good%20first%20issue) or [`help wanted`](https://github.com/ronaksarda/GitSpace/labels/help%20wanted).
- Comment on the issue before you start, so two people don't do the same work. If an issue is already claimed and has had no activity for 2 weeks, ask in the issue whether you can take it.
- For a new feature or a big change, open an issue first and describe the idea. This saves you from writing code that won't be merged.

## Set up

You need Node.js 22.12 or newer. Postgres and a C++ compiler are optional.

```bash
git clone https://github.com/<your-username>/GitSpace.git
cd GitSpace
npm install
cp .env.example .env
npm start
```

`.env.example` uses `DATABASE_URL=sandbox`, a local JSON database, so you don't need Postgres. To skip GitHub OAuth during development, set `NODE_ENV=development` and `MOCK_USER_LOGIN=<a GitHub username>` in `.env`.

The [README](README.md#run-it-locally) has the full setup, including OAuth and the optional native layout engine.

## Project layout

| Path | What it is |
| --- | --- |
| `src/backend/` | Express server, routes, GitHub refresh jobs, missions |
| `src/engine/` | C++17 island layout engine (a JavaScript fallback gives the same layout) |
| `web/src/` | React 19 + MUI UI and the Canvas 2D world |
| `test/` | Tests, run with Node's built-in test runner |

## Make your change

1. Fork the repo and create a branch from `main`, for example `fix/search-empty-state`.
2. Keep the change focused on one thing. Small PRs get reviewed faster.
3. Follow the style of the code around your change.
4. Add or update a test in `test/` when you change logic.
5. Run the tests:

   ```bash
   npm test
   ```

6. If you changed the UI, build it and check it in the browser:

   ```bash
   npm run build:web
   ```

## Open a pull request

- Link the issue in the PR description with `Fixes #<number>`.
- Say what you changed and how you tested it. Add a screenshot or GIF for UI changes.
- Make sure `npm test` passes.
- Never commit secrets. `.env` is ignored; keep it that way.

A maintainer will review your PR. Review comments are normal and not a rejection. Push more commits to the same branch to answer them.

## Report a bug

Open an issue with:

- what you did,
- what you expected,
- what happened instead (error messages, screenshots),
- your browser, OS and Node.js version if it is a local setup problem.

## Security

Do not open a public issue for a security problem. Contact the maintainer, [@ronaksarda](https://github.com/ronaksarda), privately instead.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
