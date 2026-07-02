# God in a Bottle

A luminous glass bottle contains an entire procedurally generated island. Twenty settlers
arrive. Over two hundred simulated years they explore, settle, trade, invent, suffer,
believe, fight, collapse, and recover — entirely on their own.

You are not their ruler. You cannot move a single settler. You are an invisible
supernatural influence with a slow-refilling pool of **Influence** and twelve
interventions — blessed harvests, rain, drought, plague, eclipses, comets, dreams slipped
into sleeping minds. Every act has a cost, a cooldown, immediate consequences, and
consequences that arrive decades late.

Act in patterns, and the island will notice. Gods will be named for what you do.
Rituals, taboos, prophecies, schisms and holy wars grow from your fingerprints — and that
theology feeds back into their history.

> You never controlled civilization. Civilization slowly built an understanding of you.

## Run

```
npm install
npm run dev      # local dev server
npm run build    # production build (dist/)
npm run preview  # serve the production build
```

Everything is local: no APIs, no accounts, no telemetry, no remote assets.

## Playing

- **Space** — play/pause · **1–4** — simulation speed · **Esc** — cancel targeting
- Click anything inside the bottle (settlements, ground, ruins, sacred sites) to inspect it.
- The **Chronicle** records history; **Mythology** records how they explain it; **Histories** charts the long arcs.
- Saves: autosave + 3 manual slots (localStorage) + JSON export/import. Versioned; incompatible files are refused gracefully.
- The same seed always creates the same world. Only your interventions make one telling differ from another.

## Verify the simulation headlessly

```
npx tsx scripts/simcheck.ts
```

Runs ten full 200-year histories (with and without interventions) and checks determinism,
seed variety, and save serialization.
