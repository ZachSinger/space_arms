// ==========================================
// FILE: HandbookRenderer.js
// ==========================================
// The Manager's Tablet Handbook tab: a player-facing guide, one topic at a time. Numbers
// that live in game data (levels, fees, rewards) are read from it so the text stays true.
import employeeRoster from "../../data/Employees.json" with { type: "json" };
import { SHOP_LEVEL_TIERS, getNextShopLevel } from "./ShopProgression.js";
import { DELIVERY_FEE, LOADING_PAD_SPOTS } from "./SupplyOrder.js";
import { HOVERCART_UPGRADES } from "./Hovercart.js";
import { ZONES } from "./RoomLayout.js";
import {
  EMERGENCY_LOAN_FEE_RATE,
  EMERGENCY_LOAN_REPAYMENT_RATE,
  EMERGENCY_LOAN_TARGET_BALANCE,
} from "./EmergencyLoan.js";
import { controlLabel } from "./InputDevice.js";
import { formatMoney } from "./Money.js";
import { MAX_EMPLOYEE_SKILL_LEVEL, EMPLOYEE_SPEED_BONUS_PER_LEVEL } from "./EmployeeTraining.js";

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
  return `<span class="kbd-only">${controlLabel(action, "keyboard")}</span>` +
    `<span class="pad-only">${controlLabel(action, "gamepad")}</span>`;
}

function section(title, body) {
  return `<section class="handbook-section"><h3>${title}</h3>${body}</section>`;
}

const list = (items) => `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;

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
  for (const employee of employeeRoster) {
    add(employee.requiredShopLevel, `Staff to hire: ${employee.name} (${employee.role})`);
  }
  for (const upgrade of HOVERCART_UPGRADES) {
    add(upgrade.requiredShopLevel,
      `Hovercart upgrade to ${upgrade.capacity} spaces (${formatMoney(upgrade.price)})`);
  }
  for (const zone of ZONES) {
    if (!zone.requiredShopLevel) continue;
    add(zone.requiredShopLevel, `${zone.name} (${formatMoney(zone.cost)})`);
  }
  return rewards;
}

function storeTopic({ shopLevel, reputation }) {
  const next = getNextShopLevel(shopLevel);
  const progress = next
    ? `You are at <strong>Store Level ${shopLevel}</strong> with <strong>${reputation}</strong> store
       reputation. Finish a shift with at least <strong>${next.reputation}</strong> to reach Level ${next.level}.`
    : `You are at <strong>Store Level ${shopLevel}</strong>, the highest level.`;
  return [
    section("Store Level", `
      <p class="handbook-callout">${progress}</p>
      <p>Your Store Level is shown on the top bar. It goes up when a shift ends with enough
        store reputation. Each new level unlocks something new, such as supplier contracts,
        fixtures, staff, or more shop space. The <strong>Level Rewards</strong> page lists them all.</p>
      <p>You never lose a level, even if your reputation drops later.</p>`),
    section("Reputation", `
      <p>Store reputation goes up and down based on how customers are treated.</p>
      ${list([
        "<strong>+1</strong> for every customer who pays at the register.",
        "<strong>-1</strong> when a customer gets tired of waiting in line and leaves.",
        "<strong>-1</strong> when a customer can't find anything they came for, because it's out of stock everywhere in the shop.",
        "<strong>-1</strong> when a thrown crate hits a customer.",
        "<strong>-1</strong> for handing a customer the wrong change. The first wrong try with each customer is only a warning.",
      ])}
      <p>Changes are added up during the shift and only count when the shift ends. The
        Finances tab shows the change so far.</p>
      <p>Every customer belongs to a group: Scavengers, Mercenaries, or Explorers. Serving or
        upsetting a customer also changes your reputation with their group. Some supplier
        contracts need reputation with a certain group.</p>`),
    section("Store Space", `
      ${list([
        "<strong>Sales floor:</strong> where customers shop. Shelves and the register go here.",
        "<strong>Backroom:</strong> the storeroom and the Loading Pad. Customers never go back here. Only lockers can be placed in the backroom.",
        "<strong>Loading Pad:</strong> where every order you buy arrives, as crates.",
      ])}
      <p>To get more room, buy sales floor expansions and backroom upgrades in the
        <strong>Layout</strong> tab. Each one needs a certain Store Level, costs credits, and
        must be bought in order, between shifts.</p>`),
    section("Placing Fixtures", `
      <p>Fixtures are your shelves, lockers, and the register.</p>
      ${list([
        "Buy one in the <strong>Fixtures</strong> tab. It arrives as a crate on the Loading Pad.",
        `Pick up the crate with ${key("crate")}, carry it to where you want it, and press ${key("interact")}.`,
        `A see-through copy of the fixture appears. Move it into place, turn it with ${key("rotate")}, and
          <span class="kbd-only">click</span><span class="pad-only">press A</span> to place it.
          ${key("cancel")} cancels.`,
        "The blue squares in front of a fixture must stay clear. That's where customers and staff stand to use it.",
        "A fixture can't block a doorway or cut off part of the shop, and the register needs room in front for a line.",
      ])}
      <p>Fixtures can only be placed or moved <strong>between shifts</strong>. To move one that's
        already placed, use <strong>MOVE</strong> in the Layout tab. Its contents move with it.</p>
      <p>An empty fixture can be packed back into a crate, or sold for half of what it cost.
        Your shop always keeps one register.</p>`),
    section("Starting a Shift", `
      ${list([
        "Press <strong>START SHIFT</strong> on the top bar. The game saves first.",
        "Staff wages are paid as the shift starts, even if that puts you below 0 credits.",
        "The shift clock runs from 08:00 to 20:00, about 5 minutes of play.",
        "<strong>PAUSE</strong> freezes the clock and everyone in the shop.",
        "<strong>CLOSE STORE</strong> stops new customers from coming in for a while. Customers already inside keep shopping, and the clock keeps running. <strong>REOPEN STORE</strong> lets them in again.",
      ])}
      <p>Some things can only be done between shifts: hiring staff, changing their job order,
        placing or moving fixtures, buying more space, and saving.</p>`),
    section("Ending a Shift", `
      ${list([
        "At 20:00 the doors close to new customers. Everyone already inside can still finish shopping and pay.",
        "The shift ends when the last customer leaves. A <strong>SHOP CLOSED</strong> message shows how many customers you served and turned away.",
        "Your reputation change counts now. If you reached a new Store Level, a message lists what it unlocked.",
        "Press <strong>END DAY</strong> on the top bar. It opens Finances with today's receipt. Press <strong>END DAY</strong> there to start the next day.",
        "A new day brings new market prices. Then <strong>START SHIFT</strong> appears again.",
      ])}`),
  ].join("");
}

function orderingTopic() {
  return [
    section("Ordering Stock", `
      ${list([
        "The <strong>Supply</strong> tab lists every item from the supply licenses you've signed.",
        "Each crate holds 5 of one item. The price per crate is shown next to each item.",
        `Every order has a ${formatMoney(DELIVERY_FEE)} delivery fee, however many crates are in it.`,
        `The Loading Pad has ${LOADING_PAD_SPOTS} spots, so one order can't have more crates than there are free spots.`,
        "Orders arrive on the Loading Pad right away. You can order at any time, even during a shift.",
        "Each item shows how much of it is left on your shelves, so you can see what's running low.",
      ])}`),
    section("Ordering Fixtures", `
      ${list([
        "The <strong>Fixtures</strong> tab sells shelves, lockers, and registers.",
        "Each fixture needs a fixture license. You start with Basic Fixture Supply. Higher Store Levels unlock more.",
        "A bought fixture arrives as a crate on the Loading Pad, so it needs a free spot there.",
        "See <strong>Running the Store &gt; Placing Fixtures</strong> to set it up.",
      ])}`),
    section("Equipment", `
      <p>The <strong>Equipment</strong> tab sells hovercart upgrades, which let you carry more
        items at once. Each upgrade needs a certain Store Level and must be bought in order.</p>`),
  ].join("");
}

function stockingTopic() {
  return [
    section("Crates", `
      ${list([
        "Crates wait on the Loading Pad until someone picks them up.",
        `Press ${key("crate")} to pick up a crate. Walk up to a locker or shelf and press ${key("interact")} to unload it there.`,
        `Press ${key("crate")} again to put it down. If you're walking, you'll throw it instead. Thrown crates that hit a customer cost reputation.`,
        "Walk into a crate on the floor to push it out of the way.",
      ])}`),
    section("Shelves", `
      ${list([
        "Customers only buy from shelves.",
        `Each shelf has a grid of spots. Press ${key("interact")} at a shelf to open it, then pick an item from your hovercart to give it a spot. ${key("rotate")} turns the item and ${key("cancel")} stops placing.`,
        "Once an item has a spot on a shelf, you can unload crates of it straight onto that shelf.",
        "Some items are too big for some shelves.",
      ])}`),
    section("Lockers and the Hovercart", `
      ${list([
        "Lockers hold extra stock that isn't on the shelves yet.",
        `Press ${key("interact")} at a locker to move items between it and your hovercart.`,
        "Your hovercart carries items between lockers and shelves. The top bar shows how full it is.",
      ])}`),
    section("Go-Backs", `
      <p>When a customer gives up and leaves, the items they were holding go into the Go-Backs
        bin at the register. Press ${key("goBacks")} at the register to load them into your
        hovercart, then put them back on a shelf.</p>`),
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
        "When they're done, they line up in front of the register. If they wait too long, they leave angry.",
      ])}`),
    section("Running the Register", `
      ${list([
        `Walk behind the register and press ${key("interact")}.`,
        "Scan each item by moving it across the red scanner bar.",
        "<strong>Card:</strong> type the total on the keypad and press CONFIRM TOTAL.",
        "<strong>Cash:</strong> take the customer's cash, then give back their change from the drawer. Some customers pay the exact amount, so there's no change to give.",
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
        "The <strong>Inventory</strong> tab shows each item's <strong>Market</strong> price (today's average across the galaxy) and your <strong>Price</strong>.",
        "Type a new price, or use <strong>-10%</strong>, <strong>+10%</strong>, or <strong>MKT</strong> to match the market price.",
        "The first time you order an item, its price starts at the market price.",
        "Market prices change every new day. Your prices stay where you set them.",
      ])}`),
    section("Where Money Goes", `
      <p><strong>Money in:</strong> sales.</p>
      <p><strong>Money out:</strong> stock orders, delivery fees, fixtures, licenses, hiring,
        wages, shop expansions, and hovercart upgrades.</p>
      <p>The <strong>Finances</strong> tab shows today's receipt as it happens, plus the last
        finished day.</p>`),
    section("Emergency Loan", `
      <p>If you have nothing left to sell and can't afford even one crate, Finances offers an
        emergency loan that brings you up to ${formatMoney(EMERGENCY_LOAN_TARGET_BALANCE)}.</p>
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
        "<strong>Fixture licenses</strong> decide which shelves and lockers you can buy in the Fixtures tab.",
      ])}
      <p>Sign them in the <strong>Contracts</strong> tab. Each one costs credits once, and you
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
      <p>Each employee has a job list. Whenever they're free, they go down the list from the top
        and do the <strong>first job that needs doing</strong>:</p>
      ${list([
        "<strong>Run register:</strong> a customer is in line, you aren't at the register, and no other employee is on it.",
        "<strong>Stock shelves:</strong> a shelf spot has room, and a locker has that item.",
        "<strong>Load storage:</strong> a crate is on the Loading Pad, and a locker has room for it.",
      ])}
      <p>They always finish putting away what they're carrying first. They only stock items that
        already have a spot on a shelf. With nothing to do, they take a break in the backroom and
        check again soon.</p>
      <p>At closing time, they finish up and leave once the last customer is gone.</p>`),
    section("How to Set Priorities", `
      <p>Open the <strong>Employee</strong> tab and find the employee under <strong>YOUR STAFF</strong>.
        Use <strong>UP</strong> and <strong>DOWN</strong> to reorder their job list. The top job
        comes first. Each employee has their own list. You can only change it between shifts.</p>`),
    section("How to Hire", `
      ${list([
        "Open the <strong>Employee</strong> tab and look under <strong>STAFF TO HIRE</strong>.",
        "Each person unlocks at a certain Store Level. Locked staff show which level they need.",
        "Hiring costs credits once. After that, their wages are paid at the start of every shift.",
        "You can only hire between shifts. New staff start working on the next shift.",
      ])}`),
    section("Job Levels &amp; Training", `
      ${list([
        `Each employee has three separate skills: <strong>Run register</strong>, <strong>Stock shelves</strong>,
          and <strong>Load storage</strong>. Each starts at Level 1 and can reach Level ${MAX_EMPLOYEE_SKILL_LEVEL}.`,
        "Between shifts, open the Employee tab, find the person under YOUR STAFF, and select TRAIN beside the skill you want to improve.",
        "Review the price and the new wage, then select CONFIRM TRAINING. Higher levels cost more to train.",
        "Training takes the entire next shift. That employee will not work in the shop, but you still pay their current wage when the shift starts.",
        "The skill improves when that shift ends. The higher wage starts with the following shift.",
        `Each gained level adds ${EMPLOYEE_SPEED_BONUS_PER_LEVEL}% of normal speed to that job:
          faster service at the register, faster trips carrying stock from lockers to shelves,
          or faster trips moving delivered crates into lockers.`,
        "Skills and higher wages are permanent. If you fire someone and hire them again, they keep their skills and wage, and their hiring cost is higher too.",
        "Once training is booked, wait until the employee returns before booking another course or letting them go.",
      ])}`),
    section("How to Fire", `
      ${list([
        "Open the <strong>Employee</strong> tab between shifts and find the person under <strong>YOUR STAFF</strong>.",
        "Select <strong>LET GO</strong>, then confirm. You won't get their hiring cost back.",
        "They won't work or receive wages in future shifts.",
      ])}`),
  ].join("");
}

function levelsTopic({ shopLevel, licenses }) {
  const rewards = getLevelRewards(licenses);
  const rows = SHOP_LEVEL_TIERS.filter(({ level }) => level > 1).map(({ level, reputation }) => {
    const reached = level <= shopLevel;
    const unlocks = rewards.get(level);
    return `
      <tr class="${reached ? "handbook-level-reached" : ""}">
        <td>${level}${reached ? " &#10003;" : ""}</td>
        <td>${reputation}</td>
        <td>${unlocks.length ? unlocks.join("<br>") : "&mdash;"}</td>
      </tr>`;
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
  const rows = [
    ["Walk", "WASD or arrow keys", "Left stick or D-pad"],
    ["Dash (uses stamina)", "Hold Shift", "Hold B or a trigger"],
    ["Use, open, or unload", "E", "A"],
    ["Pick up, put down, or throw a crate", "Space", "X"],
    ["Go-Backs bin (at the register)", "Q", "Y"],
    ["Manager's Tablet", "I", "Back / View"],
    ["Pause the shift", "P", "Start, then PAUSE"],
    ["Zoom", "Page Up / Page Down", "LB / RB"],
    ["Turn a fixture or shelf item", "R", "Y"],
    ["Cancel", "Esc or right-click", "B"],
  ].map(([action, keyboard, pad]) => `<tr><td>${action}</td><td>${keyboard}</td><td>${pad}</td></tr>`).join("");
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
    const buttons = HANDBOOK_TOPICS.map(({ id, label }) => `
      <button type="button" class="retro-tab-btn handbook-topic-btn${id === topic.id ? " active" : ""}"
        data-handbook-topic="${id}" aria-pressed="${id === topic.id}">${label}</button>`).join("");
    return `
      <div class="handbook">
        <nav class="handbook-topics" aria-label="Handbook topics">${buttons}</nav>
        <article class="handbook-page">
          <h2>${topic.label}</h2>
          <p class="handbook-scroll-hint pad-only">Right stick scrolls.</p>
          ${TOPIC_RENDERERS[topic.id](view)}
          <button type="button" class="retro-tab-btn handbook-back-btn" data-handbook-topic="${topic.id}">
            Back to topics</button>
        </article>
      </div>`;
  }
}
