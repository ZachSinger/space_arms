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
2. **Slice 2 (next):** dirt marks and the mop.
3. **Employees who clean (built):** see below.

### Employees who clean
- Cleaning is a third employee job, **Clean up trash**, next to Run register and Stock
  shelves. Like the others it has its own skill (Level 1–5, trained the same way) and its own
  place in the job order. The staff panel's **Prioritize Cleaning** button puts it first.
- An employee works down their job order and takes the first job that has work. Cleaning has
  work when there is floor trash nobody else is going for and a trashcan they can reach.
  Without the cleaning module, cleaning never has work.
- They walk to the nearest piece, pick it up (one at a time, carried at their side), walk to
  the nearest trashcan, and throw it away. The cleanliness level goes back up exactly as when
  you do it. Then they pick their next job again.
- Each employee reserves the piece they're walking to, so two employees never go for the same
  one. If you pick it up first, they give up on it and choose again.
- Skill makes the whole trip faster: walking, picking up, and throwing away (+20% speed per
  level, the same as the other jobs).
- At closing they leave trash they haven't picked up yet and throw away trash they're
  already carrying, so they never hold up the end of the shift. If they're removed from the
  store while carrying trash, it goes back on the floor; it's never lost or counted twice.
- Saves from before this job (save format 11 and older) add Clean up trash to the end of each
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

### The mop (slice 2 plan)
- A cheap 1x1 **Mop Bucket** fixture, from the Basic Fixture Supply contract. You place it
  like a trashcan.
- Face it with empty hands and press E to take the mop. Press E at the bucket again to put
  it back.
- While holding the mop you can't carry crates or trash.
- No wheeling the bucket around: it would add walking without adding a real choice. Where you
  place the bucket is the choice.
