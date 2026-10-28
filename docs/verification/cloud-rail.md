# The rail of Clouds and its ＋

Once a person has two places or more (their Clouds, their teams' Clouds,
servers they connected by hand), a narrow rail of circles at the window's left
edge switches between them, and ＋ buys another Cloud or adds a server of
their own. With one place there is no rail, and the window looks as before.
Nothing here needs a real MausBot Cloud account, a payment or the Electron app.

## Contract

- The desktop session may list every Cloud of the person's (`clouds`, at most
  20, contract v1 `CloudEntry`). An older Admin sends none, and the session's
  `cloud` and `teams` say everything exactly as before.
- Each Cloud the person owns besides My Cloud is a saved place of its own,
  named and coloured by the Admin, opened like a team's Cloud: the window pairs
  it through the Admin's `pairing` with that Cloud's id and takes only a grant
  for its own address. My Cloud stays the one home.
- The rail's list carries names, colours and states, never an address, and goes
  only to this app's own page and to pages of Clouds MausBot runs that the
  verified session lists. A server's own page gets none; its switcher stays the
  native Server menu. A circle opens only a place main listed, by its id, and
  only from the person's click.
- Buying another Cloud sends the plan, a name and a swatch to the Admin, which
  answers with a checkout this app opens in the browser; the sheet then follows
  the payment and the setup. An Admin that sells one Cloud per account (no
  `clouds`, `canAdd` false, or no such route) is the calm "One Cloud per
  account for now".

## Automated fixtures

```sh
node --test electron/cloud-list.node-test.mjs electron/cloud-account-clouds.node-test.mjs electron/cloud-rail.node-test.mjs electron/home-window.node-test.mjs
pnpm exec vitest run src/components/PlacesRail.test.ts src/components/cloud-buy/AddCloudFlow.test.ts
```

The account tests answer as a loopback Admin, with and without `clouds`. The
rail tests load the production preload and check which page gets the list,
which ids open, and that a circle, ＋ and checkout act only from a click.

## Rendered workflow

```sh
node --experimental-strip-types scripts/verify-cloud-rail.ts --shots .omb-scratch/verify-evidence/cloud-rail
```

It starts a disposable fake-engine server with three bots and the real app in
a Vite preview (`scripts/testing/rail-preview.tsx`), answering the desktop
bridge a hosted Cloud's page gets: six places, one being set up, one that needs
its owner, eleven for the list past eight. A headless Chrome in a throwaway
profile photographs the rail in Advanced and Simple mode, the list past eight,
＋'s two choices, the steps for a server of one's own, the plans, the name and
colour of a new Cloud and its setup, each in the Daylight and Midnight skins.
Without `--shots` it prints the preview's address and waits for Ctrl-C.

This is not production qualification: the places and the purchase are the
preview's fixtures, and no Admin, browser checkout or desktop window is
involved.
