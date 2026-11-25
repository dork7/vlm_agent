# Duplicate List closes the inline rename field before the owner can type

Status: needs-triage

GitHub: https://github.com/dork7/vlm_agent/issues/10

## Reproduction

1. Sign in to Task assignment as an Owner and open **Tasks**.
2. Create a List and add a Template. Expand the List and click **Duplicate List**.
3. When the board returns, try typing a new name and pressing Enter without clicking anything else.

## Expected

The copy's name opens in a focused inline editor so the Owner can type a new name immediately, as required by story 38 in the single-page Task board spec.

## Actual

The board returns with the expanded copy and its default “(copy)” name. The rename input briefly receives focus during navigation, but it is gone by the time the page is ready. Clicking the pencil opens the editor, and saving with Enter works. The duplicate's Tasks are present and start open.

## Verification

Reproduced on Chrome 156 on macOS against GitHub main commit `9962960cf6785531a1192f2bf654e5daac6cd37a` and local commit `9450209202541d44beaa86915abd02e00f3d25da`.

[Single-page Task board spec](https://github.com/dork7/vlm_agent/blob/9962960cf6785531a1192f2bf654e5daac6cd37a/.scratch/task-board-single-page/spec.md)
