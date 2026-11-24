# Steam Co-op plan

The idea from the TODO list: one player hosts their shop, and a friend joins and works in it
with them. Only the host can save or end the day. The goal of this first version is simply to
see two people working in the same shop. Balance comes later.

Write your answer under each question at the bottom. Skip any you want me to decide, and I'll
tell you what I picked before building it.

## What works now

The first working version is in. The friend plays the Red partner and can walk and dash around
the host's shop while it runs, and press E at the backroom door to go in and out. The friend's
screen shows everything happening there (customers, shelves, crates, money, the clock), and the
host sees the Red partner with the friend's name over their head. The friend's camera follows
the same rules as the host's: it stops at the room's edges, and zooming out stops when the whole
room fits (at the starting shop size, the room already fills the screen, so there's no zoom).
The partner can't do any shop jobs yet: no crates, register, stocking, or mopping. Only the host
can save or end the day. When either player leaves, the other is told, and the friend goes back
to the title screen. If the host switches away from the game, their shop stops; the friend sees
a message saying so and stays connected until the host comes back.

How to play it on two PCs: both PCs start Steam, then run `npm run start:steam` (on separate
Steam accounts). The host starts or continues a shop, opens the pause menu, and picks Invite a
Friend. Steam's invite window opens; pick the friend. The friend keeps their game open on any
screen and accepts the invite in Steam, and they're dropped into the host's shop. Esc leaves.
Spacewar can't launch the game from an invite, so the friend's game has to already be running.

Without Steam (two PCs on the same home network): the host picks Invite a Friend, and the pause
menu shows an address. The friend picks JOIN A FRIEND on the title screen and types it in.

On one PC (for testing): run `npm start` for the host, then open a second terminal and run
`$env:SPACE_ARMS_PROFILE="b"; npm start` for the friend. The second copy opens in a window with
its own saves and settings, and joins at the address `127.0.0.1`.

Not done yet: partner jobs (crates, register, stocking, mopping), a co-op pause rule (right now the host's pause stops the partner too), the host's
backroom side window isn't shown on the friend's screen, the glowing outlines behind shelves
don't show for the friend, and the open questions below.

## How it works

The host's game runs the shop exactly as it does today: customers, money, the clock, crates,
everything. The friend's game doesn't run its own shop. It sends the host what the friend is
pressing (walk left, pick up, open the register), the host's game moves the friend's character
and does the action, and then the host's game sends back what everything looks like so the
friend sees it on their screen. This many times a second.

This is how most co-op shop games work, because it means the two screens can never disagree
about how much money you have or who grabbed the last Plasma Rifle. The cost is that the friend
feels a tiny delay, which is fine for a shop game.

## The biggest job

The game was built for one shopkeeper, and it assumes that everywhere. When a crate gets picked
up, the game asks "is the player standing in front of it?" There is only one player to ask.
The same is true for working the register, stocking shelves, mopping, the hovercart following
you, the camera, packing remote orders, placing fixtures, and the tablet. Each of those has to
learn that there can be two shopkeepers, and which one is doing the action. Two people can't
carry the same crate, can't both work the same register, and each needs their own crates in
their arms.

This is the bulk of the work and it has to happen before any internet pieces matter.

## The order I'd build it in

First, two shopkeepers on one computer: a second character in the shop that I can move with a
controller, so we can see both working side by side before any networking exists. This shakes
out every place the game assumes one shopkeeper.

Second, two copies of the game on one computer: one hosts, one joins, talking to each other on
the same machine. This proves the "friend sends buttons, host sends back the picture" part
without needing Steam or a second PC.

Third, Steam: the host invites a friend from their Steam friends list, the friend accepts, and
they're in. Steam handles finding each other and getting through home routers.

Fourth, the polish: the menus, name tags, what happens when someone disconnects, and everything
else in the screen list below.

## What Steam needs

Steam co-op only works inside the Steam version of the game. While building it, Valve gives
every developer a free test game (called Spacewar) that we can borrow to try invites, so we
don't need the game on the Steam store yet. You'd need two Steam accounts and two PCs (or a
friend) to test the third step. For the real release, the game needs its own Steam store entry,
which is Valve's one-time $100 fee per game.

The Steam overlay (Shift+Tab) works over the game. Launch with `npm run start:steam` while
Steam is running; it opens and closes over the title screen with your friends list. Until the
game has its own Steam entry, Steam shows you as playing Spacewar. Because the overlay works,
the Invite Friend button can open Steam's own invite window instead of us building a friends
list.

## Screens and on-screen pieces we'd need

On the main menu, the host needs a way to open their shop to friends, and the friend needs a
way to join. On Steam, the friend can also just accept an invite from Steam, which opens the
game and drops them in.

A small lobby screen before the shift: who's in, each person's character, an Invite Friend
button that opens Steam's invite window, and a Start button only the host can press.

A character picker for the friend, so the two of you don't look the same (see the characters
section below).

A name tag above each shopkeeper's head showing their Steam name, so customers, employees, and
the two of you are easy to tell apart.

An arrow at the edge of your screen pointing to your partner when they're off camera.

The friend's pause menu can't stop the shop clock, so it needs to say that the shop keeps
running. Save and End Day need to be missing or greyed out for the friend, with a line saying
only the host can do those.

When the host ends the day, the friend sees the same end-of-day summary and a "waiting for the
host" message until the next shift starts.

A message when your partner disconnects or loses connection, and for the friend, a message that
the host closed the shop, which sends them back to the main menu.

A small connection indicator, so the friend can tell when lag is coming from the internet and
not the game.

## Characters for your partner

See [SteamCoopCharacters.png](./SteamCoopCharacters.png). Each row shows the character from the
front, both sides, the back, and carrying a crate.

The top row is you as you look today. Rows A, B, and C are your same mechanic in a different
color coverall. These already have every animation, including carrying a crate, so they cost
nothing to add.

For the first co-op version, use **A: Red partner** as the placeholder. A character creator is
a separate future feature, so it doesn't hold up getting co-op working.

Rows D, E, and F are characters from the customer art. They'd need new carrying-a-crate
pictures made, and they'd have to be removed from the customer list so a customer never walks
in looking like your partner.

One thing worth knowing: your employees wear a uniform that looks a lot like your mechanic's.
That's why the name tags matter, and why a partner in a clearly different color helps.

## Questions

### Who the partner is

Should the partner be a second shop owner (equal to you except for saving and ending the day),
or more like a special employee working for you?

Your answer:

### Partner character

Use **A: Red partner** as the placeholder for co-op. Later, should a character creator let
players customize both shopkeepers, or only the partner?

Your answer: Red partner for now. Character creator is a separate TODO.

### Spending money

Can the partner spend the shop's money: buying stock, hiring staff, buying fixtures and
upgrades from the tablet? Or only work the shop floor while the host makes those decisions?

Your answer:

### Moving fixtures

Between shifts, can the partner move and place shelves and other fixtures, or only the host?

Your answer:

### Pausing

Today, opening the pause menu during a shift stops the clock. In co-op, should the host's pause
menu stop the shop for both of you, or should the shop never stop while a friend is in it?

Your answer:

### What the partner keeps

When the partner goes home, do they keep anything in their own game (money, unlocks, anything
at all), or is it purely helping a friend?

Your answer:

### How many players

Is it always two, or should we plan for three or four later? It doesn't change the first
version much, but it changes how the lobby and name tags are designed.

Your answer:

### Employees

With two people working, should the employee limit stay the same, or should the shop's hiring
limit drop so it doesn't get too easy? (Fine to answer "decide later" since balance is out of
scope for now.)

Your answer:

### Anything else

Anything about co-op these questions didn't cover?

Your answer:
