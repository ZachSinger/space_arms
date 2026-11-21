// ==========================================
// FILE: HandbookRenderer.js
// ==========================================
// The Manager's Tablet Handbook tab: a player-facing guide, one topic at a time. Numbers
// that live in game data (levels, fees, rewards) are read from it so the text stays true.
import {
  SHOP_LEVEL_TIERS, getNextShopLevel, getStaffLimit, STAFF_LIMIT_LEVELS,
} from "./ShopProgression.js";
import { DELIVERY_FEE, LOADING_PAD_SPOTS } from "./SupplyOrder.js";
import { ZONES } from "./RoomLayout.js";
import {
  EMERGENCY_LOAN_FEE_RATE,
  EMERGENCY_LOAN_REPAYMENT_RATE,
  EMERGENCY_LOAN_TARGET_BALANCE,
} from "./EmergencyLoan.js";
import { CONTROL_HELP, controlLabel } from "../input/InputDevice.js";
import { formatMoneyAmount } from "./Money.js";
import {
  MAX_EMPLOYEE_SKILL_LEVEL, EMPLOYEE_MILESTONE_LEVELS, getEmployeeJobSpeed,
} from "./EmployeeTraining.js";
import { html, raw } from "../core/html.js";

export const HANDBOOK_TOPICS = Object.freeze([
  { id: "store", label: "Running the Store" },
  { id: "ordering", label: "Ordering" },
  { id: "stocking", label: "Stocking" },
  { id: "customers", label: "Customers & Register" },
  { id: "money", label: "Prices & Money" },
  { id: "licenses", label: "Licenses" },
  { id: "employees", label: "Employees" },
  { id: "levels", label: "Level Rewards" },
  { id: "controls", label: "Controls" },
]);

const percent = (rate) => `${Math.round(rate * 100)}%`;

// The key or button for an action; CSS shows whichever matches the device in use.
function key(action) {
  return html`<span class="kbd-only">${controlLabel(action, "keyboard")}</span><span class="pad-only">${controlLabel(action, "gamepad")}</span>`;
}

// Topic fragments are authored markup; dynamic game and control values are escaped when built.
function section(title, body) {
  return String(html`
    <section class="handbook-section"><h3>${title}</h3><hr class="divider-medium">${raw(body)}</section>
  `);
}

const list = (items) => String(html`<ul>${items.map((item) => raw(`<li>${item}</li>`))}</ul>`);

/**
 * Everything each Store Level unlocks, from the same data the game uses.
 * @param {{ name: string, requiredShopLevel: number, unlocksFixtures: string[] }[]} licenses
 * @returns {Map<number, string[]>}
 */
export function getLevelRewards(licenses) {
  const rewards = new Map(SHOP_LEVEL_TIERS.map(({ level }) => [level, []]));
  const add = (level, text) => rewards.get(level)?.push(text);
  for (const license of licenses) {
    if (license.requiredShopLevel <= 1) continue;
    const kind = license.unlocksFixtures.length ? "Fixture license" : "Supply license";
    add(license.requiredShopLevel, `${kind}: ${license.name}`);
  }
  for (const level of STAFF_LIMIT_LEVELS) {
    const limit = getStaffLimit(level);
    add(level, `Staff limit: up to ${limit} employee${limit === 1 ? "" : "s"} hired at once`);
  }
  for (const zone of ZONES) {
    if (!zone.requiredShopLevel) continue;
    add(zone.requiredShopLevel, `${zone.name} (${formatMoneyAmount(zone.cost)})`);
  }
  return rewards;
}

function storeTopic({ shopLevel, reputation }) {
  const next = getNextShopLevel(shopLevel);
  const progress = next
    ? String(html`You are at <strong>Store Level ${shopLevel}</strong> with <strong>${reputation}</strong> store
       reputation. Finish a shift with at least <strong>${next.reputation}</strong> to reach Level ${next.level}.`)
    : String(html`You are at <strong>Store Level ${shopLevel}</strong>, the highest level.`);
  return [
    section("Store Level", `
      <p class="handbook-callout">${progress}</p>
      <p>Your Store Level is shown on the top bar. It goes up when a shift ends with enough
        store reputation. Every new level unlocks one or two things: supplier contracts, room
        for more staff, or more shop space. The <strong>Level Rewards</strong> page lists
        them all.</p>
      <p>You never lose a level, even if your reputation drops later.</p>`),
    section("Reputation", `
      <p>Store reputation goes up and down based on how customers are treated.</p>
      ${list([
        "<strong>+1</strong> for every customer who pays at the register.",
        "<strong>-1</strong> when a customer gets tired of waiting in line and leaves.",
        "<strong>-1</strong> when a customer can't find anything they came for, because it's out of stock everywhere in the shop.",
        "<strong>-1</strong> when a thrown crate hits a customer.",
        "<strong>-1</strong> for handing a customer the wrong change. The first wrong try with each customer is only a warning. The third wrong try loses the sale, but costs no more reputation.",
      ])}
      <p>Changes are added up during the shift and only count when the shift ends. The
        Finances tab shows the change so far.</p>
      <p>Every customer belongs to a group: Scavengers, Mercenaries, or Explorers. Serving or
        upsetting a customer also changes your reputation with their group. Some supplier
        contracts need reputation with a certain group.</p>`),
    section("Store Space", `
      ${list([
        "<strong>Sales floor:</strong> where customers shop. Shelves and the register go here.",
        "<strong>Backroom:</strong> where orders arrive on the Loading Pad. Customers never go back here.",
        "<strong>Loading Pad:</strong> where every order you buy arrives, as crates.",
      ])}
      <p>To get more room, buy sales floor expansions and backroom upgrades in the
        <strong>Layout</strong> tab. Each one needs a certain Store Level, costs money, and
        must be bought in order, between shifts.</p>`),
    section("Placing Fixtures", `
      <p>Fixtures are your shelves, register, and trashcan.</p>
      ${list([
        "Buy one in the <strong>Fixtures</strong> tab. It arrives as a crate on the Loading Pad.",
        `Pick up the crate with ${key("crate")}, carry it to where you want it, and press ${key("interact")}.`,
        `A see-through copy of the fixture appears. You can walk while placing it.
          Move it with the <span class="kbd-only">mouse</span><span class="pad-only">right stick</span>,
          turn it with ${key("rotate")}, and
          <span class="kbd-only">click</span><span class="pad-only">press A</span> to place it.
          <span class="kbd-only">Esc or right-click</span><span class="pad-only">X</span> cancels.`,
        "Every fixture uses a Collision Box: its body box fits the visible fixture, and its blue projection box extends out in front. The register also needs a projection box behind it for the cashier. Keep blue areas free of furniture; people can walk through them. The body outline turns red if placement is blocked.",
        "A fixture can't block a doorway or cut off part of the shop. Customers need room to line up in front of or beside each register.",
      ])}
      <p>Fixtures can be placed or moved whenever the store is <strong>closed</strong>,
        including after pressing <strong>CLOSE STORE</strong> during a shift. To move one that's
        already placed (including the register), face it with empty hands and hold
        <span class="kbd-only">Ctrl</span><span class="pad-only">A</span>, or use
        <strong>MOVE</strong> in the Fixtures tab. Its contents move with it.</p>
      <p>An empty fixture can be packed back into a crate, or sold for half of what it cost.
        Your shop always keeps at least one register.</p>`),
    section("Starting a Shift", `
      ${list([
        "Press <strong>START SHIFT</strong> on the top bar. The game saves first.",
        "Staff wages are paid as the shift starts, even if that takes your money below 0.",
        "The shift clock runs from 08:00 to 20:00, about 7 minutes of play.",
        "<strong>PAUSE</strong> freezes the clock and everyone in the shop. All controls and menus are locked until you resume. Press P, Esc, controller Start, or <strong>RESUME</strong> to continue.",
        "<strong>CLOSE STORE</strong> stops new customers from coming in for a while. Customers already inside keep shopping, and the clock keeps running. <strong>REOPEN STORE</strong> lets them in again.",
      ])}
      <p>Some things can only be done between shifts: hiring staff, changing their job order,
        buying more space, and saving.</p>`),
    section("Ending a Shift", `
      ${list([
        "At 20:00 the doors close to new customers. Everyone already inside can still finish shopping and pay.",
        "The shift ends when the last customer leaves. A <strong>SHOP CLOSED</strong> message shows how many customers you served and turned away.",
        "Your reputation change counts now. If you reached a new Store Level, a message lists what it unlocked.",
        "Press <strong>END DAY</strong> on the top bar to start the next day immediately. You can review past receipts in Finances.",
        "A new day brings new market prices. Then <strong>START SHIFT</strong> appears again.",
      ])}`),
  ].join("");
}

function orderingTopic() {
  return [
    section("Ordering Stock", `
      ${list([
        "The <strong>Supply</strong> tab lists every item from the supply licenses you've signed.",
        "Each crate holds one item type, as many as fill one space on a Budget Shelf 2x2: from 20 of the smallest items down to 1 of the largest. Each item shows its crate size and price.",
        `Every order has a ${formatMoneyAmount(DELIVERY_FEE)} delivery fee, however many crates are in it.`,
        `The Loading Pad has ${LOADING_PAD_SPOTS} spots, so one order can't have more crates than there are free spots.`,
        "Orders arrive on the Loading Pad right away. You can order at any time, even during a shift.",
        "Each item shows how much of it is left on your shelves, so you can see what's running low.",
      ])}`),
    section("Ordering Fixtures", `
      ${list([
        "The <strong>Fixtures</strong> tab sells shelves, registers, and trashcans.",
        "Each fixture needs a fixture license. You start with Basic Fixture Supply. Higher Store Levels unlock more.",
        "A bought fixture arrives as a crate on the Loading Pad, so it needs a free spot there.",
        "See <strong>Running the Store &gt; Placing Fixtures</strong> to set it up.",
      ])}`),
  ].join("");
}

function stockingTopic() {
  return [
    section("Crates", `
      ${list([
        "Crates wait on the Loading Pad until someone picks them up.",
        "Crate colors show the item group: gray for weapons, red for ammunition, blue for attachments, purple for clothing, green for armor, yellow for tools, and teal for survival supplies.",
        "A green arrow points at the crate you're facing that you can reach. The bar at the bottom of the screen shows what's in that crate, and cards above the bar's right side show the crates in your hands, top crate first.",
        `Tap ${key("crate")} to pick up the crate the arrow points at. Hold ${key("crate")} to pick up that crate and every crate stacked on it. You can carry up to three crates; the newest one is on top.`,
        `Press ${key("nextCrate")} to move the arrow one crate down a stack, so you can pick up a lower crate.`,
        `If you're holding a crate and the arrow points at a crate of the same item, ${key("crate")} moves as many of its items as fit into your crate instead of picking it up. Anything that doesn't fit stays in the crate on the floor; if everything fits, that crate is left empty on the floor.`,
        `Tap ${key("putDown")} to put your top crate down in front of you. Hold ${key("putDown")} to set everything you're carrying down as one stack.`,
        `When the arrow points at a crate on the floor, ${key("putDown")} puts your crates on top of it instead: tap for one, hold for as many as fit. Stacks on the floor can be up to three crates high. Nothing can be stacked on a fixture crate or on the Loading Pad, and fixture crates are never stacked.`,
        `While walking with no arrow showing, press ${key("crate")} to throw your crate the way you're walking. You can only throw when you're carrying just one crate. Thrown crates that hit a customer cost reputation.`,
        "Thrown crates fall from your hands to the floor. A sideways throw lands level with where your feet were when you threw it. Walls block the crate's floor position, not its raised artwork.",
        "Only the lower part of a crate blocks movement, so its top can overlap a wall above it while its base stays on the floor.",
        "Carrying two crates slows you down; a third slows you down further. Empty crates slow you less than filled crates. Your character faces the direction you move, and the crates stay straight.",
        `Press ${key("interact")} at a shelf to stock it by hand.`,
        "Walk into a crate on the floor to push it out of the way. A taller stack is harder to push, and so is any crate while you're carrying something. You can never move more than 4 crates at once, counting the ones you're carrying. Customers shove crates out of their way, no matter how heavy.",
      ])}`),
    section("Shelves", `
      ${list([
        "Customers only buy from shelves.",
        "A thin cyan light marks the side of each Budget Shelf that customers shop from. It fades on and off once every three seconds.",
        "While you carry a crate of items, every shelf in the shop that has a space for that item pulses with a green outline, even if that space is sold out.",
        `Press ${key("interact")} at a 2x2 through 2x4 or 3x2 through 3x4 Budget Shelf to see its front up close, whichever way it faces in the shop.`,
        "Hold the left mouse button on a shelf space to place boxes one by one from your carried crates. Each space holds one kind of item. Small boxes fit twenty to a space; the largest fit one.",
        "Carrying more than one crate of items? While the shelf is open, press Q (Y on a controller) to pick which crate stocks next. That crate glows green in your crate list on the right side of the screen. It's used for empty spaces, and for spaces that hold its item.",
        "Shelf spaces show a picture of their item. A green border marks spaces that match an item in your crates, even when the space is sold out. Point the mouse at a space to see the item's name and how many are on it in the bar at the bottom of the screen.",
        "A sold-out space keeps its item, and customers keep looking for that item there. Until you clear it, only that item can be stocked there. Right-click a sold-out space to clear it, so customers stop looking there and you can stock something else.",
        "Hold the right mouse button to take boxes back into an empty crate, or a crate of the same item with room left. You can work while carrying up to three crates; the highest matching crate is used.",
        "The shop keeps running. Customers take boxes from the front first, including while you stock. Each stocked space has an orange price sticker on its top-right corner showing what customers pay for one; it turns grey and says SOLD OUT when the space is empty. Click a sticker to change that item's price: type a new price, or use -10%, +10%, or MARKET (today's market price). Press Esc to put the price box away.",
        `Empty crates stay in your hands. Beside a trashcan on the sales floor, press ${key("interact")} to put all your held empty crates in it. Filled crates stay in your hands. Press ${key("interact")} with completely empty hands to take one free empty crate. ${key("putDown")} still puts crates on the floor; it does not put them in the trashcan.`,
      ])}`),
    section("Go-Backs", `
      <p>When a customer gives up and leaves, the items they were holding go into the Go-Backs
        bin. A yellow "!" above your character means something is waiting in it. The Go-Backs pack
        themselves right away: first into any crate that already holds the same item and has room
        (on the floor, on the Loading Pad, or in your arms), then into empty crates. Anything still
        left is packed into new
        crates, stacked up to three high. The new crates go to the backroom when it has room;
        otherwise they're set down on the shop floor near the register, out of everyone's way. If
        there isn't floor space yet, the rest wait in the bin and are packed as soon as room opens
        up. Nothing can be put into the bin.</p>`),
  ].join("");
}

function customersTopic() {
  return [
    section("How Customers Shop", `
      ${list([
        "Each customer comes in looking for certain items. They walk to the shelves, look around, and pick things up.",
        "Customers may buy 1, 2, or 3 of the same item. They only take as many as are available on your shelves.",
        "If nothing they came for is in stock anywhere in the shop, you lose 1 reputation.",
        "Customers only buy an item if your price isn't too far above the market price. Each customer will pay a little more or less than the others.",
        "When your price is well below the market price, customers show they're happy about the good deal.",
        "When they're done, they line up at a register — if you have more than one, they pick the shortest line. If they wait too long, they leave angry.",
        "Customers get 10 extra seconds for each person ahead when they join a line. Moving up gives them 5 more seconds unless they reach the front, where they won't leave because of waiting.",
      ])}`),
    section("Running the Register", `
      ${list([
        `Walk behind the register and press ${key("interact")}.`,
        "Click each item to scan it, or hold the mouse button and move over several items. Only the scanned item slides across the red bar; the others keep moving at normal belt speed.",
        "<strong>Card:</strong> type the total on the keypad and press CONFIRM TOTAL. Backspace removes the last character; CLEAR erases the whole entry.",
        `<strong>Cash:</strong> take the customer's cash, then give back their change from the drawer. The large CURRENT CHANGE amount is what you have counted out; CHANGE OWED is what the customer needs back. CURRENT CHANGE turns green when it matches exactly and red when it's too much. Press ${key("handOverChange")} to hand it over. Some customers pay the exact amount, so there's no change to give.`,
        "<strong>Scavengers:</strong> most pay in M-Scrips. 120 M-Scrips equal 1 credit; if the price doesn't convert to a whole M-Scrip, round the amount up. Their bills come in 1, 5, 10, 25, 50, 100, 500, and 1,000 M-Scrips. The sale still earns its listed price in credits, and any change is in M-Scrips.",
        "<strong>Explorers:</strong> most pay with a travel Chit. The Chit shows its value and a code made of 2 to 5 digits, each from 1 to 4. Enter the code with the arrow keys or the on-screen buttons (up = 1, down = 2, left = 3, right = 4); on a controller, use the D-pad. You have 10 seconds to enter the whole code, and the bar under your input shows the time left. The clock starts over only after a mistake. A wrong direction, or running out of time, resets the code. After three mistakes in one sale, the Explorer gives up and leaves angry: you lose the sale and store reputation, and their items go to the Go-Backs bin. The sale completes when you enter the last digit correctly, and the Explorer takes the Chit back. No change is given.",
        "Release the mouse button after scanning. Start a new click or click-and-hold to collect the customer's cash.",
        `To step away, press ${key("interact")} again<span class="pad-only"> or B</span>. The sale waits for you exactly as you left it.`,
      ])}
      <p>Staff can also run the register. See <strong>Employees</strong>.</p>`),
  ].join("");
}

function moneyTopic() {
  return [
    section("Setting Prices", `
      ${list([
        "The <strong>Inventory</strong> tab shows how many of each item you own: <strong>On Shelves</strong> is what customers can buy right now, and <strong>In Crates</strong> is what's still packed in crates anywhere in the shop, backroom, or loading pad. It also shows your <strong>Price</strong> and <strong>Profit</strong> for each item. Profit is your price minus the cost of one item in a supply crate; delivery fees are not included.",
        "Type a new price, or use <strong>-10%</strong>, <strong>+10%</strong>, or <strong>MKT</strong> to match today's market price (the galactic average).",
        "The first time you order an item, its price starts at the market price.",
        "Market prices change every new day. Your prices stay where you set them.",
      ])}`),
    section("Where Money Goes", `
      <p><strong>Money in:</strong> sales.</p>
      <p><strong>Money out:</strong> stock orders, delivery fees, fixtures, licenses, hiring,
        wages, and shop expansions.</p>
      <p>The <strong>Finances</strong> tab shows today's receipt as it happens, plus the last
        finished day.</p>`),
    section("Emergency Loan", `
      <p>If you have nothing left to sell and can't afford even one crate, Finances offers an
        emergency loan that brings you up to ${formatMoneyAmount(EMERGENCY_LOAN_TARGET_BALANCE)}.</p>
      ${list([
        `You pay back ${percent(EMERGENCY_LOAN_FEE_RATE)} more than you borrowed.`,
        `At the end of each day, ${percent(EMERGENCY_LOAN_REPAYMENT_RATE)} of that day's sales goes toward the loan.`,
        "You can pay it all off early from Finances.",
      ])}`),
  ].join("");
}

function licensesTopic() {
  return [
    section("Two Kinds of License", `
      ${list([
        "<strong>Supply licenses</strong> decide which items you can order in the Supply tab.",
        "<strong>Fixture licenses</strong> decide which shelves, registers, and trashcans you can buy in the Fixtures tab.",
      ])}
      <p>A new shop starts with Basic Fixture Supply already signed. Its first available
        supply contract is Basic Rations &amp; Water.</p>
      <p>Sign them in the <strong>Contracts</strong> tab. Each one is paid for once, and you
        keep it for good.</p>`),
    section("How to Unlock Them", `
      <p>Each contract lists what it needs. Anything you're still missing is shown in red.</p>
      ${list([
        "<strong>Store Level:</strong> reach that level. See <strong>Level Rewards</strong>.",
        "<strong>Store reputation:</strong> have at least that much store reputation.",
        "<strong>Group reputation</strong> (Scavengers, Mercenaries, or Explorers): serve more customers from that group.",
      ])}
      <p>Signed contracts are listed last in the Contracts tab.</p>`),
  ].join("");
}

function employeesTopic() {
  return [
    section("How They Choose Their Tasks", `
      <p>Each employee can do every job. When they're free, they try their first job,
        then go down their job order to the next job that needs doing:</p>
      ${list([
        "<strong>Run register:</strong> a register has customers in line and nobody — you or another employee — is working it. Each register is worked by one person at a time, so more registers let more staff ring up customers at once.",
        "<strong>Stock shelves:</strong> a crate anywhere in the shop or backroom has items, and a matching shelf spot has room.",
        "<strong>Clean up trash:</strong> there is trash on the shop floor and a trashcan they can walk to. They pick up the nearest piece nobody else is going for, one at a time, and throw it in the nearest trashcan. If you pick up that piece first, they go for another one.",
      ])}
      <p>They take a matching crate — from the Loading Pad, the backroom, or the shop floor,
        top of a stack first — straight to its shelf spot. They only
        stock items that already have a spot on a shelf. With nothing to do, they take a break in the backroom and
        check again soon.</p>
      <p>After stocking, they carry leftover stock to an existing crate stack with room
        before taking more floor space. Deliveries are put away in the backroom when it has room,
        leaving the Loading Pad free. If no stack has room, loose crates from elsewhere
        go back to their original spot when it is still clear.
        When a crate is empty, they carry it to the nearest reachable trashcan.</p>
      <p>Staff wear orange sleeves and dark work aprons. When carrying a crate,
        they hold it above their head with both arms raised. When cleaning, they carry one
        piece of trash at their side.</p>
      <p>At closing time, they finish up and leave once the last customer is gone. Someone on
        the way to a piece of trash leaves it where it is; someone already carrying trash
        throws it away first.</p>`),
    section("How to Set Priorities", `
      <p>Open the <strong>Employee</strong> tab and find the employee under <strong>YOUR STAFF</strong>.
        Choose <strong>Prioritize Register</strong>, <strong>Prioritize Stocking</strong>, or
        <strong>Prioritize Cleaning</strong> to make that their first job. The other jobs keep their
        order behind it, shown under <strong>Job order</strong>.
        They try their first job first, but still do the others when they need doing.
        You can only change this between shifts.</p>`),
    section("How to Hire", `
      ${list([
        "Open the <strong>Employee</strong> tab and look under <strong>STAFF TO HIRE</strong>.",
        "Everyone starts with the same skills, hiring cost, and wages. Pick whoever you like.",
        `Your Store Level sets how many employees you can have hired at once: one at Level
          ${STAFF_LIMIT_LEVELS[0]}, then one more at Levels ${STAFF_LIMIT_LEVELS.slice(1).join(", ")}.`,
        "Hiring is paid for once. New hires start On Shift.",
        "You can only hire between shifts. New staff start working on the next shift.",
      ])}`),
    section("On Shift & Off Shift", `
      ${list([
        "Each person under <strong>YOUR STAFF</strong> has an <strong>ON SHIFT</strong> and an <strong>OFF SHIFT</strong> button. The lit one is their current setting.",
        "<strong>On Shift:</strong> they come to work, and you pay their wages when each shift starts.",
        "<strong>Off Shift:</strong> they stay home and aren't paid. They keep all their skills.",
        "You can change the setting between shifts. Everyone you've hired can be On Shift at the same time.",
        "An employee away training is <strong>not available</strong> for that shift, whatever their setting. Their wage for that shift is still paid. After training, they go back to their usual setting.",
      ])}`),
    section("Job Levels & Training", `
      ${list([
        `Each employee has three separate skills: <strong>Run register</strong>, <strong>Stock shelves</strong>,
          and <strong>Clean up trash</strong>. Each starts at Level 1 and can reach Level ${MAX_EMPLOYEE_SKILL_LEVEL}.`,
        "Booking new training courses is not currently available.",
        "An already-booked course takes the entire next shift. That employee will not work in the shop, but you still pay their current wage when the shift starts.",
        "The skill improves when that shift ends. The higher wage starts with the following shift.",
        `Run register gains a larger speed boost at Levels ${EMPLOYEE_MILESTONE_LEVELS.join(" and ")}:
          employees work ${Math.round((getEmployeeJobSpeed({ register: 3 }, "register") - 1) * 100)}% faster
          at Level 3 and ${getEmployeeJobSpeed({ register: 5 }, "register")} times normal speed at Level 5.`,
        "Stock shelves makes restocking trips faster with each level.",
        "Clean up trash makes cleaning trips, and picking up and throwing away trash, faster with each level.",
        "Skills and higher wages are permanent.",
        "If an employee is already away training, wait until they return before changing On Shift / Off Shift.",
      ])}`),
  ].join("");
}

function levelsTopic({ shopLevel, licenses }) {
  const rewards = getLevelRewards(licenses);
  const rows = SHOP_LEVEL_TIERS.filter(({ level }) => level > 1).map(({ level, reputation }) => {
    const reached = level <= shopLevel;
    const unlocks = rewards.get(level);
    const unlockMarkup = unlocks.map((unlock, index) => html`
      ${unlock}${index < unlocks.length - 1 ? raw("<br>") : null}
    `);
    return String(html`
      <tr class="${reached ? "handbook-level-reached" : ""}">
        <td>${level}${reached ? raw(" &#10003;") : null}</td>
        <td>${reputation}</td>
        <td>${unlocks.length ? unlockMarkup : raw("&mdash;")}</td>
      </tr>`);
  }).join("");
  return section("What Each Level Unlocks", `
    <p>Finish a shift with at least the listed store reputation to reach that level. Levels
      you've reached are marked with a check. Things with a price still have to be bought.</p>
    <table class="handbook-table">
      <thead><tr><th>Level</th><th>Reputation</th><th>Unlocks</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`);
}

function controlsTopic() {
  const rows = CONTROL_HELP
    .map(({ label, keyboard, gamepad }) => String(html`
      <tr><td>${label}</td><td>${keyboard}</td><td>${gamepad}</td></tr>
    `))
    .join("");
  return [
    section("Controls", `
      <table class="handbook-table">
        <thead><tr><th>Action</th><th>Keyboard</th><th>Controller</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`),
    section("Menus on a Controller", `
      ${list([
        "D-pad or left stick moves the yellow highlight. A selects. B goes back.",
        "LB and RB switch tablet tabs. The right stick scrolls.",
        "Start jumps to the buttons on the top bar.",
      ])}`),
  ].join("");
}

const TOPIC_RENDERERS = {
  store: storeTopic,
  ordering: orderingTopic,
  stocking: stockingTopic,
  customers: customersTopic,
  money: moneyTopic,
  licenses: licensesTopic,
  employees: employeesTopic,
  levels: levelsTopic,
  controls: controlsTopic,
};

export class HandbookRenderer {
  /**
   * @param {{ topic: string, shopLevel: number, reputation: number, licenses: object[] }} view
   */
  static generateHTML(view) {
    const topic = HANDBOOK_TOPICS.find(({ id }) => id === view.topic);
    if (!topic) throw new Error(`Unknown handbook topic: ${view.topic}`);
    const buttons = HANDBOOK_TOPICS.map(({ id, label }) => String(html`
      <button type="button" class="retro-tab-btn handbook-topic-btn${id === topic.id ? " active" : ""}"
        data-handbook-topic="${id}" aria-pressed="${String(id === topic.id)}">${label}</button>
    `)).join("");
    return String(html`
      <div class="handbook-panel">
        <div class="fixtures-panel-heading">
          <h2 class="type-h2">Topics</h2>
        </div>
        <div class="fixtures-panel-heading">
          <h2 class="type-h2">${topic.label}</h2>
        </div>
        <hr class="divider-thick fixtures-panel-divider">
        <section class="fixtures-section">
          <nav class="retro-slot custom-scrollbar handbook-topics" aria-label="Handbook topics">${raw(buttons)}</nav>
        </section>
        <section class="fixtures-section">
          <article class="retro-slot custom-scrollbar handbook-page">
            <p class="handbook-scroll-hint pad-only">Right stick scrolls.</p>
            ${raw(TOPIC_RENDERERS[topic.id](view))}
          </article>
        </section>
      </div>`);
  }
}
