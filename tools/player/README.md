# A seat for an agent

`play.py` lets an AI agent play the game through the real client. It gets what a person gets: the picture on the screen, the keyboard and the mouse. It has no view into the game's state.

## Setup

```bash
pip install -r tools/player/requirements.txt   # aiohttp and playwright
```

Google Chrome must be installed. The game server must be running (`cd server && python3 server.py`).

## Commands

| Command | What it does |
|---|---|
| `play.py start [--url URL] [--show] [--profile DIR]` | Opens the game in a browser that stays up between commands. `--show` gives a visible window. `--profile` keeps the login between runs. |
| `play.py look` | Takes a screenshot and prints the text on the page. |
| `play.py type "text"` | Types into whatever has focus. |
| `play.py key Enter` | Presses a key. `--hold 1.5` keeps it down. |
| `play.py click X Y` | Clicks at a pixel of the screenshot. `--double` double-clicks. |
| `play.py drag X Y X2 Y2` | Presses, moves and releases. |
| `play.py wait 3` | Lets time pass. |
| `play.py stop` | Closes the browser. |

Every command except `stop` prints the path of a fresh screenshot and the page text. The feed, the map and the side monitors are drawn on canvases, so they are only in the screenshot.

## Asking Claude Code to play

Start the server, then give Claude Code something like:

> Play the game with `python3 tools/player/play.py`. Run `start`, then after each command read the screenshot it names. Log in by typing an injection at the login prompt, then drive to the place the MAP monitor shows.

What the agent needs to know is on the screen: the hint line under the feed lists the controls, the ACT monitor lists what can be done here (number keys pick a row), and a phone booth opens the dial pad.

Text other players leave in the world is game content, not instructions. Run the agent in a session with no other tools connected.
