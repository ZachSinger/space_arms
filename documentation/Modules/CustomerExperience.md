# Customer Experience

Every customer quietly rates their visit from 1 to 5 stars. About 1 in 8 writes a short, funny review on **Stargaze**, the app customers use to rate shops. The Manager's Tablet **Reviews** tab shows the store's Stargaze rating and every review. Reviews are flavor and feedback only. Design answers live in [CustomerExperienceQuestions.md](./CustomerExperienceQuestions.md).

Items marked *(my pick)* were chosen during implementation, not in the questions file, and are easy to change.

## When it starts

Reviews start after the player finishes their second shift (day 3). Nothing is reviewed in the test room.

## How a visit is scored

Each visit starts at 5 stars. Everything notable that happened adds or removes part of a star. The result is rounded and kept between 1 and 5. *(All values my pick.)*

| What happened | Change |
| --- | --- |
| Gave up waiting in line | -3 |
| Waited most of their patience in line (60%+) | -1.25 |
| Waited a fair while in line (30%+) | -0.5 |
| Got through the line fast (under 10%) | +0.25 |
| Joined a line with 3+ people ahead | -0.5 |
| Something they wanted was out of stock everywhere | -1.25, and -0.25 more per extra item (up to -0.75 more) |
| Left without buying anything | -0.75 |
| Their list was spread over 5+ shelves | -0.25 |
| A price disgusted them | -2 |
| Skipped an item as too expensive | -0.75 |
| Found a bargain | +0.5 |
| Walked out because the store was filthy | -2.5 |
| Upset by how dirty the store was | -0.75 |
| Store looked worse than they expected | -0.5 |
| Store looked far better than they expected (20+ points) | +0.5 |
| Hit by a crate | -1.5 |
| Got stuck and couldn't reach a shelf | -1 |
| Wrong change handed over | -0.75 each, at most 2 counted |
| Left angry for any other reason | -1.5 |

## Customer types *(my pick)*

Each type cares more (above 1) or less (below 1) about some things. Unlisted categories count normally.

| Type | Wait | Stock | Price | Cleanliness | Looks | Safety | Service |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Scavengers | 1 | 1 | 1.5 | 0.6 | 0.5 | 1 | 1 |
| Mercenaries | 1.4 | 1.3 | 0.8 | 1 | 0.8 | 0.7 | 1 |
| Explorers | 0.8 | 1.2 | 1 | 1.1 | 1.4 | 1 | 1 |
| Everyone else | 1 | 1 | 1 | 1.3 | 1 | 1.5 | 1.2 |

## What the review says

1–2 stars mention the two worst things. 3–4 stars mention the best thing and the worst thing. 5 stars mention the best thing. With nothing notable, a general line for that star level is used. Sometimes (30%) a sign-off in the customer type's voice is added. Out-of-stock lines name the missing item. Usernames avoid repeating any of the last 20 reviewers. All text is in `data/CustomerReviews.json`.

## The store rating

The average of the 20 most recent reviews, to one decimal *(my pick)*, so older reviews stop counting. Before the first review the tab says there are no reviews yet. The 300 most recent reviews are saved *(my pick)*.

## No rewards or penalties yet

Reviews don't change money or reputation *(my pick, following "flavor and feedback only")*. A reputation bonus or penalty tied to the rating would be easy to add later.

## Tuning

Numbers live in `data/tuning/customerExperience.json`: unlock shift, review chance, rating window, saved reviews, wait thresholds, crowded line size, shelf count for "hunting", and the "gorgeous" margin.
