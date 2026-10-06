# Asteroid Walk

**Asteroid Walk** is an interactive WebGL experience that lets you stand on, traverse and orbit small Solar System bodies.

The project explores what it might feel like to move on an asteroid using real-world scale, low gravity, escape velocity, hard vacuum lighting and mission imagery.

## Current experience

- First-person EVA on asteroid surfaces
- Surface / orbit mode
- Human-scale camera and low-gravity movement
- Bennu-inspired terrain based on NASA OSIRIS-REx mission data
- Mission gallery for Bennu, Ryugu, Vesta, Eros and Kleopatra
- Desktop and mobile controls
- HD / balanced rendering modes
- Three.js WebGL rendering

## Tech

- JavaScript
- Three.js
- HTML / CSS
- WebGL
- Node.js static development server
- NASA / JAXA mission reference material

## Run locally

Run `node server.js` and open `http://localhost:8095`.

## Assets

This repository includes the lightweight assets required for the normal experience. The original high-resolution `nightingale.glb` mission mesh is intentionally not committed because it is about 74 MB and would make the portfolio repository unnecessarily heavy. The app falls back to the lighter terrain representation if that HD mesh is unavailable.

Scientific imagery and mission-derived assets remain credited to their respective agencies and missions inside the application.

## Status

Active prototype. The project is being iterated toward a more realistic asteroid exploration experience.

Part of the **Nomadic Labs / Nomadic Tide** project portfolio.
