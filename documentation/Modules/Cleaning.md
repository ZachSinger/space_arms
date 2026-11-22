# Cleaning (module)

## Mess
As customers move through the store, they sometimes create smudges, filth, or scuffs, or leave
trash behind (cans, crumpled papers, small boxes, etc.).

## Cleanliness level
- The store has a cleanliness level that goes down as mess builds up.
- Maximum: 20, +20 for each store expansion purchased, +2 for each Store Level beyond Store
  Level 5.
- Each loose piece of garbage takes away 1 point. Each dirt mark takes away 2 points.

## Customer reactions
- Each customer has two hidden cleanliness tolerances, randomly generated based on their
  faction.
  - Below their **higher** tolerance: you take a store reputation hit.
  - Below their **lower** tolerance: they leave the store in disgust, and you take two
    reputation hits instead of one.
- A customer decides about 3 real-life seconds after entering the store.
  - They never grab an item before deciding.
  - They decide only once and never re-check cleanliness for the rest of their trip.

### Expectations by faction (lowest to highest)
1. Scavengers
2. Regular customers
3. Mercenaries
4. Explorers

## Cleaning up
- **Loose garbage:** pick up each piece (one at a time) and put it in a trashcan. The
  cleanliness level goes back up.
- **Scuffs, marks, smudges, filth:** pick up the mop, walk up to the mark, and press E
  repeatedly until a small gauge fills. The mark disappears and the cleanliness level goes
  back up.

## Decisions (filled in during the build)
These answer the open questions in the design above.

### Build order
1. **Slice 1 (built):** trash only. Customers drop trash, you pick it up and throw it in a
   trashcan, the store has a cleanliness level shown in the top bar, and customers judge it.
2. **Slice 2 (built):** dirt marks, Mop Bucket, and player mopping.
3. **Employees who clean (built):** see below.

### Employees who clean
- Cleaning is a third employee job, **Clean the store** (called Clean up trash before mopping), next to Run register and Stock
  shelves. Like the others it has its own skill (Level 1–5, trained the same way) and its own
  place in the job order. Drag Cleaning to the desired position in the staff panel, or use
  **Move up / down**; highest priority is at the top. The saved order changes between shifts only.
- An employee works down their job order and takes the first job that has work. Cleaning has
  work when there is floor trash nobody else is going for and a trashcan they can reach, or
  a dirt mark nobody else is going for and a Mop Bucket whose mop is free. Trash comes first.
  Without the cleaning module, cleaning never has work.
- They walk to the nearest piece, pick it up (one at a time, carried at their side), walk to
  the nearest trashcan, and throw it away. The cleanliness level goes back up exactly as when
  you do it. Then they pick their next job again.
- Each employee reserves the piece they're walking to, so two employees never go for the same
  one. If you pick it up first, they give up on it and choose again.
- Mopping: they reserve the nearest free bucket and the nearest dirt mark, take the mop,
  and mop the mark with the same four-direction sweeping animation as the player. One sweep
  equals one player press (8 per mark); a sweep takes 250 ms at Level 1, so a mark takes
  about 2 seconds. The arms sweep faster as the skill goes up. After a mark, they move to the
  next unreserved mark, and put the mop back in its bucket when none are left.
- One mop per bucket: while an employee has it, the player can't take it and the bucket
  can't be moved, crated, or sold. If the player takes the mop before the employee reaches
  the bucket, the employee gives up and chooses again. The player and an employee can both
  mop the same mark; whoever finishes it, the other moves on.
- Skill makes the whole trip faster: walking, picking up, throwing away, and mopping (+20%
  speed per level, the same as the other jobs).
- At 20:00 they finish the cleaning task already underway, including picking up the claimed
  piece and throwing it away. They take no new cleaning or stocking jobs, but still serve
  customers already inside at the register before walking out through the public front
  door. The shift waits until they reach the exit. If they're removed from the
  store while carrying trash, it goes back on the floor; it's never lost or counted twice.
  Someone mopping finishes their current mark, then returns the mop without starting another.
  A mop held by an employee who is removed, or when a save is loaded, goes straight back
  into its bucket; employee mops are not saved.
- Saves from before this job (save format 11 and older) add the cleaning job to the end of each
  employee's job order, at Level 1.

### Cleanliness level
- Maximum: 20, +20 for each **sales floor** expansion bought (the backroom never gets dirty,
  so backroom expansions don't count), +2 for each Shop Level above 5.
- Score: maximum, minus 1 per piece of trash, minus 2 per dirt mark. Never below 0.
- Shown in the top bar as `CLEANLINESS 18/20`. It turns orange below 75% and red below 50%.

### Customer tolerances
Tolerances are percentages of the maximum, so a bigger store isn't judged more harshly just
for being bigger. Each customer rolls two numbers when they arrive:

| Customer | Upset below | Walks out below |
|---|---|---|
| Scavenger | 40–60% | 10–25% |
| Regular (no faction) | 55–75% | 25–40% |
| Mercenary | 65–85% | 35–50% |
| Explorer | 75–95% | 45–60% |

- Upset: they look disappointed and you lose 1 store reputation. They keep shopping.
- Walks out: they look angry, you lose 2 store reputation, and they leave right away.
- These are store reputation only; faction reputation isn't touched.
- The 3 seconds only count while the game is running (not paused). If a customer reaches a
  shelf sooner, they decide right then, before taking anything.

### Trash
- About 3 in 20 customers drop one piece of trash (a can, crumpled paper, or small box)
  somewhere on the sales floor, 1 to 6 seconds into their walking (the walk out counts).
- Trash lies on the floor, under people, crates, and shelves. Hold H to light up every
  piece, even ones hidden behind shelves.
- Trash stays until you clean it up, including overnight, and is saved with the game.
- Pick up: face the trash with empty hands and press E. You can hold one piece at a time.
- Throw away: face a trashcan and press E.
- Drop it again: press Q.
- You can't pick up crates while holding trash.
- If a fixture is placed on top of trash, the trash is pushed to the nearest open floor.

### Dirt and the mop
- A cheap 1x1 **Mop Bucket** fixture, from the Basic Fixture Supply contract. You place it
  like a trashcan.
- Face it with empty hands and press E to take the mop. Press E at the bucket again to put
  it back.
- While holding the mop you can't carry crates or trash.
- You also cannot use shelves or work the register while holding it.
- No wheeling the bucket around: it would add walking without adding a real choice. Where you
  place the bucket is the choice.
- New dirt marks randomly choose one of the three approved appearances: dark smudges,
  footprints, or scuffs. Their appearance never changes when saving or loading.
- The bucket and mop use the first mockup's yellow bucket and cotton mop; the progress
  indicator uses its small horizontal blue bar.
- Stand still, face the mark, and repeatedly press the current interaction button.
  Held keys and repeated keydown events do not count as new presses.
- The character's arms and mop sweep back and forth in all four facing directions.
  Faster fresh presses shorten the sweep; the animation settles when pressing stops.
  Employees use the same renderer on their own uniforms (see Employees who clean).
- Dirt costs 2 cleanliness points until the mark is fully cleaned. Partial progress,
  position, and appearance persist overnight and through save/Continue. Loading returns
  the held mop to its bucket. The additive dirt save field is optional for older saves.
- Holding H highlights dirt as well as trash. Placing fixtures over dirt moves it to the
  nearest open floor, preserving unfinished cleaning.
- Starting values chosen during implementation, not balance targets: a 15% independent
  chance of one dirt mark per customer, 1–6 seconds into walking; 8 fresh presses per
  mark; bucket price 40. Dirt chance and press count live in `data/tuning/cleaning.json`;
  bucket price lives in `data/Fixtures.json`.

### Verification
`node scripts/browser/mopping.mjs` checks buying and placing the bucket, real keyboard
presses, all four directions, different pressing speeds, carry restrictions, save/Continue,
and the shared renderer with every employee uniform. `node scripts/browser/check-optional-cleaning.mjs`
also checks preserved dirt and bucket behavior when the module is disabled.
`node scripts/browser/employee-mopping.mjs` checks, in a real shift, that an employee fetches the
mop, mops dirt in all four facing directions, and puts the mop back.
