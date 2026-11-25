# Tata Play 24/7 Always-On Free Cloud Relay 🚀

A zero-cost, serverless-ready cloud microservice designed for **TiviMate**, **OTT Navigator**, and **ExoPlayer**.
It automatically proxies Tata Play DASH live manifests, injects dynamic browser origin headers to defeat Akamai Ghost 400 errors, and formats channels with native `#KODIPROP` ClearKey decryption directives.

---

### Features
- **Dynamic Header Injection**: Injects required `Origin: https://watch.tataplay.com` and `Referer` headers on all upstream manifest calls.
- **Dual ClearKey Resolution**: Supports both W3C Base64 JSON Web Key (JWK) sets and raw hex `KID:KEY` pairs.
- **Auto-Updating In-Memory Cache**: Automatically syncs channel lists and live keys every 6 hours without service restarts.
- **Multi-Playlist Routing**:
  - `/playlist.m3u` - Complete 700+ channel catalog
  - `/sports.m3u` - Dedicated Sports suite (Star Sports HD, Sony Sports Ten HD, Sports18)
  - `/tamil.m3u` - Regional Tamil catalog

---

### One-Click Free Deployment

#### Deploy to Render.com (Recommended)
1. Fork or push this repository to your GitHub account: `https://github.com/Maady012/tataplay-cloud-relay`.
2. Open [Render Dashboard](https://dashboard.render.com).
3. Click **New +** -> **Web Service**.
4. Select `tataplay-cloud-relay`.
5. Settings:
   - **Environment**: `Node` (or `Docker`)
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: `Free`
6. Click **Create Web Service**. Your live URL will be:
   `https://tataplay-cloud-relay.onrender.com`

---

### TiviMate & OTT Navigator Configuration
- **M3U Playlist URL**: `https://<YOUR-RENDER-APP>.onrender.com/playlist.m3u`
- **Sports M3U URL**: `https://<YOUR-RENDER-APP>.onrender.com/sports.m3u`
- **EPG URL**: `https://raw.githubusercontent.com/Maady012/maddytv-iptv/main/epg.xml.gz`
