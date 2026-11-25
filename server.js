const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// In-memory cache for channel metadata and ClearKeys
let channelsData = [];
let clearKeyMap = {};
let lastFetchTime = 0;

const DATA_URL = "https://raw.githubusercontent.com/Babel-In/Tata-Play-IPTV/main/data.json";
const CK_URL = "https://raw.githubusercontent.com/Rajveer-Mahida/tataplay_live/main/src/staticData/config.json";
const TG_URL = "https://raw.githubusercontent.com/piyushsingh8373/Tataplay-Tivimate-link/main/TataPlay-TG@M3UIndia-23Dec.m3u";

function sanitizeBrand(str) {
  if (!str) return "";
  return str
    .replace(/tata\s*play/gi, "Maddy")
    .replace(/tatasky/gi, "Maddy")
    .replace(/tata/gi, "Maddy")
    .trim();
}

async function refreshCacheIfNeeded() {
  const now = Date.now();
  if (channelsData.length === 0 || now - lastFetchTime > 6 * 60 * 60 * 1000) {
    try {
      console.log("[Relay] Syncing upstream catalogs and ClearKeys...");
      const [resData, resCk, resTg] = await Promise.all([
        axios.get(DATA_URL, { timeout: 15000 }),
        axios.get(CK_URL, { timeout: 15000 }),
        axios.get(TG_URL, { timeout: 15000 })
      ]);

      channelsData = resData.data || [];
      const ckList = resCk.data || [];
      
      clearKeyMap = {};
      for (const item of ckList) {
        if (item.channel_id) {
          clearKeyMap[String(item.channel_id)] = {
            key: item.key && item.key[0] ? item.key[0] : null,
            channel_key: item.channel_key || null
          };
        }
      }

      // Merge keys from Telegram community M3U (includes Zee TV HD, Colors HD, etc.)
      const tgLines = (resTg.data || "").split("\n");
      for (let i = 0; i < tgLines.length; i++) {
        const line = tgLines[i];
        if (line.includes("#KODIPROP:inputstream.adaptive.license_key=")) {
          const keyJsonStr = line.split("#KODIPROP:inputstream.adaptive.license_key=")[1].trim();
          let nextExt = tgLines[i + 1] || "";
          let nextUrl = tgLines[i + 2] || "";
          if (!nextExt.startsWith("#EXTINF") && tgLines[i + 2]?.startsWith("#EXTINF")) {
            nextExt = tgLines[i + 2];
            nextUrl = tgLines[i + 3] || "";
          }
          const m = nextExt.match(/tvg-id="ts(\d+)"/);
          if (m && m[1]) {
            const cid = m[1];
            try {
              const parsedKey = JSON.parse(keyJsonStr);
              clearKeyMap[cid] = {
                channel_key: parsedKey,
                linear_url: nextUrl.trim().startsWith("http") ? nextUrl.trim() : null
              };
            } catch (e) {}
          }
        }
      }

      lastFetchTime = now;
      console.log(`[Relay] Synced ${channelsData.length} channels and ${Object.keys(clearKeyMap).length} ClearKeys.`);
    } catch (err) {
      console.error("[Relay] Error syncing cache:", err.message);
    }
  }
}

// Stealth root health endpoint
app.get("/", (req, res) => {
  res.json({
    status: "online",
    system: "MaddyFusion Live Core",
    version: "2.2.0",
    catalog: channelsData.length
  });
});

// Master All-In-One & Category Playlists
app.get("/:endpoint", async (req, res) => {
  await refreshCacheIfNeeded();
  let ep = req.params.endpoint.toLowerCase().replace(".m3u", "");
  // Force HTTPS for Android players
  const host = `https://${req.get("host")}`;

  let header = `#EXTM3U x-tvg-url="https://raw.githubusercontent.com/Maady012/maddytv-iptv/main/epg.xml.gz,https://avkb.short.gy/tsepg.xml.gz"\n\n`;
  let entries = [];

  for (const ch of channelsData) {
    const id = String(ch.id || "");
    const rawName = ch.channel_name || "Unknown";
    const name = sanitizeBrand(rawName);
    const logo = ch.channel_logo || "";
    const genres = Array.isArray(ch.channel_genre) ? ch.channel_genre : [ch.channel_genre || "General"];
    const genre = sanitizeBrand(genres[0] || "General");
    const langs = Array.isArray(ch.subchannel_names) ? ch.subchannel_names : [ch.subchannel_names || "All"];
    const lang = langs[0] || "All";

    // Filtering logic
    if (ep === "sports") {
      const isSport = genres.some(g => String(g).toLowerCase().includes("sport")) ||
                      rawName.toLowerCase().includes("sport") ||
                      rawName.toLowerCase().includes("cricket");
      if (!isSport) continue;
    } else if (ep === "tamil") {
      if (lang.toLowerCase() !== "tamil") continue;
    } else if (ep === "telugu") {
      if (lang.toLowerCase() !== "telugu") continue;
    } else if (ep === "hindi") {
      if (lang.toLowerCase() !== "hindi") continue;
    }

    const streamData = ch.streamData || {};
    const origUrl = streamData.dashWidewinePlayUrl || streamData.initialUrl;
    if (!origUrl || !origUrl.startsWith("http")) continue;

    const ckInfo = clearKeyMap[id];
    let kodiProp = "";
    
    if (ckInfo && ckInfo.channel_key) {
      kodiProp += `#KODIPROP:inputstream=inputstream.adaptive\n`;
      kodiProp += `#KODIPROP:inputstream.adaptive.manifest_type=mpd\n`;
      kodiProp += `#KODIPROP:inputstream.adaptive.license_type=clearkey\n`;
      kodiProp += `#KODIPROP:inputstream.adaptive.license_key=${JSON.stringify(ckInfo.channel_key)}\n`;
    } else if (ckInfo && ckInfo.key) {
      kodiProp += `#KODIPROP:inputstream=inputstream.adaptive\n`;
      kodiProp += `#KODIPROP:inputstream.adaptive.manifest_type=mpd\n`;
      kodiProp += `#KODIPROP:inputstream.adaptive.license_type=clearkey\n`;
      kodiProp += `#KODIPROP:inputstream.adaptive.license_key=${ckInfo.key}\n`;
    }

    const proxyStreamUrl = `${host}/live/${id}/manifest.mpd`;
    entries.push(
      `#EXTINF:-1 tvg-id="maddy_${id}" tvg-name="${name}" tvg-logo="${logo}" group-title="${lang} | ${genre}", ${name}\n` +
      kodiProp +
      `${proxyStreamUrl}\n`
    );
  }

  res.setHeader("Content-Type", "audio/x-mpegurl");
  res.setHeader("Content-Disposition", `inline; filename="${ep}.m3u"`);
  res.send(header + entries.join("\n"));
});

// Stream manifest proxy with stealth headers & edge resolution
app.get("/live/:id/manifest.mpd", async (req, res) => {
  await refreshCacheIfNeeded();
  const id = req.params.id;
  const ch = channelsData.find(c => String(c.id) === id);

  if (!ch) {
    return res.status(404).send("Stream unavailable");
  }

  const streamData = ch.streamData || {};
  const ckInfo = clearKeyMap[id] || {};
  let targetUrl = ckInfo.linear_url || streamData.dashWidewinePlayUrl || streamData.initialUrl;

  if (!targetUrl) {
    return res.status(404).send("Stream offline");
  }

  if (targetUrl.includes("linear.akamaized.net") || targetUrl.includes("catchup.akamaized.net")) {
    targetUrl = targetUrl.replace("bpprod", "bpaita");
  }

  try {
    const upstream = await axios.get(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://watch.tataplay.com/",
        "Origin": "https://watch.tataplay.com"
      },
      timeout: 10000,
      responseType: "text"
    });

    res.setHeader("Content-Type", "application/dash+xml");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(upstream.data);
  } catch (err) {
    res.redirect(targetUrl);
  }
});

app.listen(PORT, async () => {
  console.log(`[MaddyFusion Live Core] Listening on port ${PORT}`);
  await refreshCacheIfNeeded();
});
