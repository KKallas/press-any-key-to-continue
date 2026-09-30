# Milestone 1: One block

*The smallest playable slice that proves the idea. Everything outside this list waits.*

## The question it answers

Does running from terminal to terminal against a timer, in a world that visibly rewrites itself, feel uncanny and fun?

## Contents

| Piece | Minimum version |
|---|---|
| **Block** | One city block at night, top-down. Street, sidewalk, a few buildings built by the generator from a description. |
| **Skin** | Random skin on login using the three-part imprint (who I am, what I can do, what I carry). |
| **Car** | One old car. Breaking in means a timed arrow sequence. Fail and you start over, with the clock still running. |
| **Terminal** | One in-world terminal wired to one emulated pre-2000 machine in a sandbox. One real, documented, era-correct way in. |
| **Vending machine** | Buy, hack, or search for a coin, as in the original notes. |
| **Agent** | One agent, one timer. Caught means the skin is released: *press any key to continue*. |
| **Suitcase** | Appears in the car. Opens to a laptop showing an editable part of the block's prompt. Closing it makes it disappear. The next login regenerates the block from the edited prompt. |
| **Persistence** | The emulated machine keeps its state between players until a reset. A reset regenerates the block. |

## Not in this milestone

Multiple blocks, multiple agents, driving between districts, operator configuration, licensing, merch, moderation tooling, accounts.

## Technical spikes to do first

1. **Generator loop.** Qwen reads a block description and outputs parameters for a procedural building script. Is the result coherent enough to play in?
2. **Emulator in a sandbox.** One pre-2000 machine running under emulation in a locked-down container, reachable only through a terminal in the game client.
3. **Top-down renderer.** One block, night lighting, a car that drives.
4. **Timer and agent.** The simplest pursuer that creates pressure.

## Done means

A new player logs in as a stranger, steals the car, reaches the terminal, gets in, finds the suitcase, changes something, and gets caught. When they log in again as someone else, the block is different, and they aren't sure whether they caused it.
