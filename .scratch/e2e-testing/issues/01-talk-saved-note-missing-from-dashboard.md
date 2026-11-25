# Talk confirms a Note was saved but the dashboard never shows it

Status: needs-triage

GitHub: https://github.com/dork7/vlm_agent/issues/8

## Reproduction

1. Open the dashboard's **Talk** page and hold the microphone button or Space.
2. Ask the assistant to save a Note, then release the button.
3. Wait for the transcript and the confirmation that the Note was saved.
4. Open **Notes** from the same dashboard and search for the confirmed Heading.

## Expected

The Note is visible in the dashboard that accepted the request.

## Actual

Talk displayed and spoke “Saved your note …”. The Notes page contained no matching Note. The Note row exists in MongoDB under a fixed synthetic web owner, while the dashboard lists Notes for the current User.

## Verification

Reproduced at GitHub main commit `9962960cf6785531a1192f2bf654e5daac6cd37a` with Chrome 156 on macOS, the app's HTTP and WebSocket routes, MongoDB, the repo's audio fixture as microphone input, whisper.cpp, and the default macOS speech command. The model response was deterministic and selected the documented `save_note` tool.
