# Battle Royale — Real Online Multiplayer (Node.js + Socket.io)

## Kaise chalayein (local test — apne Windows PC pe)

1. Zip extract karo, folder mein jaao:
   ```
   cd br-multiplayer
   ```
2. Dependencies install karo:
   ```
   npm install
   ```
3. Server start karo:
   ```
   npm start
   ```
4. Browser mein kholo: `http://localhost:3000`
5. **Doosre player ke saath test karne ke liye:**
   - Ek doosra browser tab kholo, same URL — 2 "players" ban jayenge, round auto start hoga
   - Ya same WiFi pe doosre device se apne PC ka local IP use karo (e.g. `http://192.168.1.5:3000`) — Windows `ipconfig` se IP nikaal sakte ho

## Kaise kaam karta hai (architecture)

- **server.js** = authoritative server. Sab movement, shooting, zone shrink, hit detection SERVER pe calculate hota hai — clients sirf apna input (move direction + aim angle + shooting) bhejte hain, 20 baar/second.
- Server 30 times/second poori game state (sab players, bullets, zone, pickups) sabko broadcast karta hai.
- **public/index.html** = client. Sirf render karta hai jo server bhejta hai — isse cheating (speed hack, wall hack) mushkil hota hai kyunki client kabhi apni position khud decide nahi karta.
- Ye wahi pattern hai jo Sarkar Yojana ke backend mein use hua — Express serve karta hai frontend, aur real-time cheezon ke liye Socket.io.

## Real internet pe deploy karna (taaki kahin se bhi log join kar sakein)

Free/cheap options:
- **Render.com** — free tier, Node.js apps directly deploy ho jaate hain GitHub se
- **Railway.app** — easy Node.js deploy, free credits milte hain
- **Fly.io** — free tier available

In sab pe process same hai: GitHub repo banao (`git init`, push code), phir us platform pe "New Web Service" → apna repo connect karo → auto-detect Node.js → deploy. `PORT` environment variable already server.js mein handle hai.

## Agla improvement steps (jab basic version test ho jaaye)

1. **Rooms/lobbies** — abhi sab ek hi room mein hain; multiple simultaneous matches ke liye room system chahiye
2. **Reconnect handling** — agar player ka internet cut ho to unka player kuch second wait kare before removing
3. **Anti-cheat rate limiting** — input event pe basic sanity checks (already partially done via server-authoritative movement)
4. **Better maps/assets** — abhi sirf circles/rectangles hain, actual sprite images/tilesets add kar sakte ho
5. **Mobile app wrapping** — Capacitor use karke isi web app ko Android APK/iOS app mein wrap kar sakte ho baad mein

## Files
- `server.js` — game server (authoritative)
- `public/index.html` — client (renders + sends input)
- `package.json` — dependencies (express, socket.io)
