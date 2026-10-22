# Current Chief job status

The footer reads `/api/threads/:id/job?since=0`. Its `current` summary is
the most recent visible source job on the selected transcript branch,
computed before node clipping. Aggregate job status remains available for
existing wait clients. Saved cancellation receipts remain in the transcript;
they do not determine the current job's status.

The mounted footer revalidates after a branch change, reconnect, focus or
receipt update. While native source jobs remain active it uses the API's
bounded version wait, with an abort signal tied to the mounted conversation.
Settled views stop waiting. These reads invoke no model and start no job.

Native uncertainty is reported separately by source job. A historical partial
receipt stays visible as a past report; it cannot establish current process
state. Cancel actions retain exact native root IDs for overlapping work.

## Isolated verification

Run on the eligible execution worker with repository dependencies installed:

```sh
pnpm exec vitest run src/components/ChiefJobCancel.test.ts \
  src/components/ChiefJobCancel.status.test.ts server/job-view.test.ts \
  server/routes/jobs.test.ts
OMB_UI_E2E=1 pnpm exec vitest run server/job-cancellation-api.test.ts
```

The browser case launches a temporary fake-engine server, private browser
home and real renderer. It cancels an older source job while a newer source
job runs, verifies the newer running status, completes it, reloads the page,
and checks that the completed status returns while the old receipt persists.
It retains screenshots, API evidence and console output at the paths printed
by the test. The fixture closes its browser, preview and server in `finally`.

On a Linux fixture host without usable Chrome sandbox support,
`OMB_UI_NO_SANDBOX=1` applies only to the disposable test browser. It changes
no deployed browser, worker or application permission.

Component cases cover fresh mount, active and completed transitions, partial
history, native uncertainty outside loaded history, reconnect/focus, stale
thread responses and cancellation races. API cases cover active-path
selection, source visibility, clipping and held-read version changes.
