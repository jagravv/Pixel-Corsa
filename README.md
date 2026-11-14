<p align="center">
  <a href="https://pixelcorsa.netlify.app">
    <img src="https://cdn.modrinth.com/data/cached_images/8ec0d0f2ba2a08c4a8a2cb8eea9800687c23ea9c_0.webp"
         alt="Pixel Corsa"
         width="100%" />
  </a>
</p>
# Pixel Corsa

1. Version: v0.4.1
2. Last Updated: 14th November 2026
3. Developer: Jagrav 

### Overview
Pixel Corsa is a Indie, top-down 2D pixelated game, inspired from actual Simulators and Trackmania with arcady physics and proper delta times/sector times

### Changelog
- Replaced the main menu’s text buttons with the supplied Play, Settings, and Quit pixel-art images and adjusted their size and spacing to fit without a scrollbar.
- Added theme-aware Pixel Corsa logos: the light logo is used in Light mode, while the original logo remains for Dark and OLED modes. Enlarged the main menu logo.
- Updated the Discord icon while preserving its size, position, and invite-link behavior.
- Added the Experimental menu icon and entry point for Time Attack and Multiplayer.
- Matched Back button typography to the pixel style used by the other menu buttons.
- v0.4.1: Refined the main menu with theme-aware logos, supplied Play/Settings/Quit icons, updated Discord icon, and the Experimental menu entry; adjusted menu sizing and spacing.

### Circuits
1. TCK-01 
2. TCK-02

### Technical Details
- Language: HTML, CSS and JavaScript
- Rendering: Rendered with the browser’s Canvas 2D API at an 800×400 game resolution
- Framwork: NO framework is used, only vanilla JavaScript with HTML and CSS
- Multiplayer: Early developmental LAN available

### Controls
1. Accelerate - W
2. Brake/Reverse - S
3. Steer Left - A
4. Steer Right - D
5. Clutch (hold) - C
6. Upshift - E
7. Downshift - Q
8. Start/Restart Engine - I
9. DRS (toggle) - F
10. Reset Car - R
*These are the default key bindings, you can bind the keys*

### Multiplayer
Pixel Corsa’s multiplayer is LAN-only and uses a small Node.js server with WebSockets
1. The host will run the batch file Start-Pixel-Corsa-LAN.bat. This will start the server, which will show an IP address, typically port 3000. 
2. Everyone connects to the same IP address on their own device whilst connected to the same Wi-Fi/Ethernet network. 
3. The host will create a room, which gives them a 4 digit code. Up to 4 players can join the room. They can then select their driver name, livery and get ready. 
4. Once everyone is ready, the host will select the track and race type (Free Run, 3 lap Sprint or 5 lap GP). A synced countdown will begin. 
5. Each browser will simulate their own car. The server will receive updates from each player and send them to the other browsers. The server has validation and rate limiting in place but is intended for casual local multiplayer. It does not allow online matchmaking, players must be on the same local network as the host.
*Note: This is a very early in developmental version of the LAN Multiplayer version, features like car collision and public multiplayer is still not implemented. Bugs may be there too*
### Future Plans
In the near future: 
1. Public multiplayer version with car collision and proper races
2. Imrpoved GUI
3. More tracks and road courses
