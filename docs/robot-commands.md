# Robot Commands

Write anything here. A command is "if (condition), then (action)." There are no rules about how to word them. Write them the way you think about them, and I'll work out how to make the game do it.

What's already written below is only what the Robot Lab has today. Change it, delete it, or add to it however you like.

--## Conditions (the "if" part)

--Always
--My charge is below 20%
--My charge is below 50%
--My charge is not full
--A customer is waiting at a register
--A register line is 3 or more customers long
--A shelf is empty
--A shelf is below 25% full
--A shelf is below 50% full
--A shelf isn't full
--There's a crate on the loading pad
--There's a mess on the sales floor

--## Actions (the "then" part)

## Condition Target
-Me
-Store
-Customer
-Player
-Register
-Shelf
-Time
-Crate


### Condition Comparators
#### Me
-Charge below n
-Charge above n
-Charge is full
-Charge is not full
-Charge is at n

#### Store
-Has mess on sales floor
-Is open
-Is closed
-Has cleanliness equal to n
-Has cleanliness below n
-Has cleanliness above n

#### Customer
-At Register
-Is Waiting
-Is losing patience
-Is upset about cleanliness
-Is upset about presentation

#### Register
-Is not open
-Is open
-Has no line
-Has line of n or more customers
-Has line of exactly n customers
-Has line of less than n customers

#### Shelf
-Slot is empty
-Slot is not full
-Slot is below n% full
-Slot is above n% full
-Slot is at n% full


#### Time
-Is before n
-Is after n
-Is exactly n


## Action Target
-Me
-Store
-Customer
-Player
-Register
-Shelf
-Time
-Crate


## Actions

### Me
-Wait
-Go to a charging station and charge fully
-Go to a charging station and charge until n%

### Shelf
-Restock item
-Remove
-Restock to n% full
-Restock fully

### Register
-Serve a customer
-Serve n customers
-Serve any customers

### Store
-Open Store
-Close Store
-Clean up the sales floor
-Clear Loading Pad

## Modifiers

Commands decide what a robot does. Modifiers decide how well it does it.

Every robot starts with a base level in each skill. The robot's parts only set how fast it moves around the store. Modifier boards raise skills.

Modifier boards increase a skill by a percentage, not a flat amount.

### Skills

Stocking: how fast the robot puts units on a shelf.
Carry: how many crates the robot can carry at once.
Scanning: how fast the robot scans a customer's items at a register.
Counting: how fast the robot counts out a customer's change at a register.

Scanning and Counting together decide how long the robot takes to check out each customer.
Handle Waste: how many pieces of garbage the robot can hold at once before it has to empty them into the nearest trashcan.
Mopping: how fast the robot cleans up dirty spots.

Most modifier boards raise one stat. Some raise more than one. For example, Register 1 and Stock 2 could be on the same board, but that board costs much more and needs much more power than a board with either one on its own.

Modifier boards go in the same frame slots as logic boards, so every modifier board a robot carries is a slot it can't use for commands, and the reverse is true too.

If a robot has two boards that raise the same skill, their percentages do not add together; only the strongest percentage counts. The other board still uses its slot and power, so the game has to make that crystal clear when the player sets it up.

Prefab boards are made from the same pieces players use. We build a few basic logic boards and modifier boards ourselves and sell them ready-made. Players who don't want to program can just buy those, while players who do can build their own from the same parts.

## Notes

TODO: Need to reconsider backroom crate storage, maybe some cool sorter/animation is in order!
