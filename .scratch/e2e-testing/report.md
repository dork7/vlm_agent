# End-to-end test report

Tested November 19, 2026, in isolated copies of the local checkout and GitHub's default branch. The revisions diverged, so each was tested with its own lockfile and a clean `npm ci` install.

## Results

| Check | Local `9450209` | GitHub `main` `9962960` |
| --- | --- | --- |
| `npm run typecheck` | Passed | Passed |
| `npm test` | 367 passed, 1 failed | 392 passed, 1 failed |
| `npm run test:slow` with the Whisper model | 3 passed | 3 passed |
| Browser and HTTP workflows | 9 passed, 1 failed | 9 passed, 2 failed |

## Issues filed

| Finding | Reproduced on | GitHub |
| --- | --- | --- |
| Talk confirms a Note was saved and plays the reply, but the Notes dashboard cannot find the saved record. MongoDB stored the Note under a different owner ID from the dashboard User. | GitHub `main` | [#8](https://github.com/dork7/vlm_agent/issues/8) |
| The assignment theme test expects the retired `Appearance:` label. Chrome successfully cycled through all three theme modes on both pages covered by the test. | Both | [#9](https://github.com/dork7/vlm_agent/issues/9) |
| Duplicating a List creates fresh copies, then closes the inline rename field before the Owner can type. Clicking the pencil and pressing Enter still saves a new name. | Both | [#10](https://github.com/dork7/vlm_agent/issues/10) |

## Browser and HTTP coverage

- Health and Inventory API key enforcement, item listing and SKU lookup.
- Dashboard Task editing, completion and reopening, plus Note search, editing and deletion.
- Assignment login with an emailed-link test double, theme switching, Template selection and copying a share link at a 390 px viewport.
- Assignee name entry and completion, native drag-and-drop in both directions with live Assignee updates, List duplication and rename, and revocation of an open share.
- On GitHub `main`, Talk microphone capture, actual Whisper transcription, a scripted model classification, actual macOS text-to-speech, browser audio playback and a check for the saved Note in the dashboard.

## Environment and limits

- Node.js 26.8.2, Chrome 156 on macOS, a Fastify listener on loopback and disposable MongoDB. The browser checks used a temporary Playwright harness.
- The speech tests used the repository's audio fixture, ffmpeg, whisper.cpp and `ggml-small.en.bin`. Chrome used the fixture as its microphone input.
- The suite exercises Telegram and model integration through test doubles. Live Telegram, hosted model and web search calls, external email delivery, the separate LiveKit voice session and other browsers were outside this run.
