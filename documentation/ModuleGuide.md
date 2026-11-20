# Game Module Guide

Game modules are optional gameplay features managed by `ModuleHost` in
[`js/modules/GameModules.js`](../js/modules/GameModules.js). The enabled module IDs are listed in
`ENABLED_GAME_MODULES`; removing an ID disables that feature for the whole game.

## Module contract

- Register the module factory in `GameModules.js` and give its instance the matching `id`.
- The host constructs each enabled module once per game scene, calls optional
  `update(time, delta)` each frame, and calls optional `destroy()` during scene shutdown.
- Register player actions with the shared `InteractableRegistry`; do not add a parallel input or
  hint system.
- Register decisions through `gameState.rules.register(name, rule)`. Rules receive a context and
  must return a boolean. Any `false` vetoes the decision; exceptions and invalid return values
  remain visible errors. Keep the returned unregister function and call it from `destroy()`.
- Optional customer behavior is exposed by the module through the customer-store interface.
  Customer code must not import a module that may be disabled.
- Durable data belongs in a `GameState` slice and the standard save validation and upgrade path.
  The module host owns runtime lifecycle, not an unvalidated second save format.
- If a module changes where characters can walk, its room's `navigationWalkabilityKey()` must
  change too. Rooms without that method do not reuse cached routes or cached walkability cells.

Cleaning demonstrates the optional-feature boundary: the scene, HUD, customer policies, and
interactions all tolerate the module being absent. Its saved trash data remains part of the save
format, so disabling the feature does not discard existing save data.

## Planned feature fit

| Feature | Module responsibilities | Shared game support |
|---|---|---|
| Shooting Range | Own lanes, programs, range visitors, payment, and the 1800 entry cutoff. | Use shared movement, interactions, and customer shopping; add an area/portal registration hook if the existing area system cannot represent the stairs and lower floor. |
| Drone Deliveries | Own orders, terminal/pad actions, order expiration, and each order's locked mixed crate. | Use container transfer rules for stock movement and a `GameState` slice for saved orders. |
| Presentation | Track decoration value and register the reputation-gain rule. | Sale gains include the customer in the rule context, so each customer's expectation can veto a gain before tallying. `reputation.lose` is a separate path and remains available. |

Before implementing a module, confirm its needs fit these shared services. If it would require
editing unrelated systems at many call sites, add a focused registration hook to the shared
system first, then test both the enabled and disabled module paths.
