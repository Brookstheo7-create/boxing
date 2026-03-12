# 🥊 KNOCKOUT — LAN Boxing Game

A shockingly realistic 3D multiplayer boxing game you can play on your local network.

## Setup

```bash
cd boxing-game
npm install
npm start
```

## Play

1. Run the server on one machine
2. **Player 1**: Open `http://localhost:3000` on the host machine
3. **Player 2**: Open `http://<HOST-IP>:3000` on another machine on the same network
   - The host IP is printed in the terminal when the server starts

## Controls

| Key | Action |
|-----|--------|
| `W` `A` `S` `D` | Move |
| `J` | Jab (fast, low damage) |
| `K` | Cross (medium, big rotation) |
| `L` | Hook (wide arc, knockdown risk) |
| `I` | Uppercut (power punch, high KO chance) |
| `SPACE` | Guard / Block (hold to block) |

## Features

- **Full 3D PBR rendering** — ACES filmic tone mapping, soft shadow maps, sRGB output
- **Detailed boxer models** — 30+ mesh parts per fighter with skeletal rig
- **Smooth animations** — Jab, cross, hook, uppercut, guard, hit reaction, knockdown, rising, victory
- **Ring** — Canvas floor, turnbuckles, 3-layer ropes with sag, padded corners, apron
- **Crowd** — 5 rows of audience with colored crowd textures
- **Lighting** — 4 overhead spotlights + rim lighting + arena atmosphere lights
- **Effects** — Screen shake, hit flash, KO flash, particles, smoke, crowd noise (Web Audio)
- **Game logic** — 3 rounds, stamina system, blocking (70% damage reduction), knockdowns, KO count
