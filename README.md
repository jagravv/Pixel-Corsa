# Pixel Corsa v0.4.1

Pixel Corsa now includes an optional LAN multiplayer server. The game is still a static HTML/CSS/JS project, but LAN racing is enabled when the game is opened from the host PC's local server rather than from the public HTTPS website.

## Fast start (Windows host)

1. Install [Node.js 18 or newer](https://nodejs.org/) on the host PC. Other players do not need Node.js.
2. Extract this whole project folder.
3. Double-click `Start-Pixel-Corsa-LAN.bat`.
4. If Windows Firewall prompts, permit Node.js on **Private networks only**.
5. The terminal prints URLs like `http://192.168.1.25:3000`. Open one on the host PC and give that exact LAN URL to friends on the same Wi-Fi/Ethernet LAN.
6. In the game, choose **Multiplayer → Host LAN Room**. Friends choose **Multiplayer → Join Room** and enter the 4-character room code.
7. Host chooses TCK-01/TCK-02 and Free Run, 3-Lap Sprint or 5-Lap GP. Each guest picks a livery and must mark Ready before the host starts.

The server serves the website and its WebSocket endpoint from the same origin, so this LAN setup does not need TLS certificates, port forwarding, npm installs or any tunnel service. This build intentionally does not expose multiplayer over the public internet.

## v0.4.1 Menu update

- Added the themed Pixel Corsa logos and supplied pixel-art Play, Settings, and Quit menu buttons.
- Refined menu sizing and spacing, updated the Discord icon, and added the Experimental menu entry for Time Attack and Multiplayer.

Time-trial records and ghost samples are stored in browser localStorage and are local to that browser profile. The sector markers are derived from the saved ghost lap's driven distance, rather than separately authored physical track gates.

## What's included

- Private room codes, 2–4 drivers, name/livery preferences, ready status and host-controlled settings
- Synchronized countdown, live remote car sprites, driver nameplates and LAN room HUD
- Practice and 3-/5-lap sessions, finish order/results, host return-to-lobby and host migration
- Dependency-free Node.js server using built-in HTTP and WebSocket handling

## Troubleshooting

- **Use the LAN URL, not Netlify.** The public `https://pixelcorsa.netlify.app/` site is not connected to your local LAN server.
- **Never share `http://localhost:3000` with another PC.** `localhost` means that player's own device. Share the host's `http://<host-LAN-IP>:3000` URL printed by the server.
- If friends cannot load the page, check they are on the same non-guest Wi-Fi/Ethernet network and allow Node.js through Windows Firewall on Private networks.
- If port 3000 is occupied, close the other service or start the server with a different port, for example `set PORT=3001` in Command Prompt before running `node server.js`; then tell every player to use that port.
- Room codes work only while the host server is running. Closing the server ends all rooms.

## Technical notes

- WebSocket endpoint: `/multiplayer`
- Health endpoint: `/health`
- LAN server default port: `3000`
- Maximum room size: 4 players
- Network updates are rate limited and the server validates message shapes/ranges. Movement is client-simulated and relayed, so this version is intended for trusted local play, not competitive anti-cheat.

