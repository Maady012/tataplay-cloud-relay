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

async function refreshCacheIfNeeded() {
  const now = Date.now();
  // Refresh cache every 6 hours
  if (channelsData.length === 0 || now - lastFetchTime > 6 * 60 * 60 * 1000) {
    try {
      console.log("[Relay] Refreshing channels data and ClearKeys...");
      const [resData, resCk] = await Promise.all([
        axios.get(DATA_URL, { timeout: 15000 }),
        axios.get(CK_URL, { timeout: 15000 })
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
      lastFetchTime = now;
      console.log(`[Relay] Loaded ${channelsData.length} channels and ${Object.keys(clearKeyMap).length} ClearKeys.`);
    } catch (err) {
      console.error("[Relay] Error refreshing cache:", err.message);
    }
  }
}

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "online",
    name: "Tata Play Always-On Cloud Relay",
    channels: channelsData.length,
    endpoints: {
      playlist: "/playlist.m3u",
      sports: "/sports.m3u",
      tamil: "/tamil.m3u"
    }
  });
});

// Dynamic M3U Playlist generator
app.get("/:type.m3u", async (req, res) => {
  await refreshCacheIfNeeded();
  const type = req.params.type.toLowerCase();
  const host = `${req.protocol}://${req.get("host")}`;

  let header = `#EXTM3U x-tvg-url="https://raw.githubusercontent.com/Maady012/maddytv-iptv/main/epg.xml.gz,https://avkb.short.gy/tsepg.xml.gz"\n\n`;
  let entries = [];

  for (const ch of channelsData) {
    const id = String(ch.id || "");
    const name = ch.channel_name || "Unknown";
    const logo = ch.channel_logo || "";
    const genres = Array.isArray(ch.channel_genre) ? ch.channel_genre : [ch.channel_genre || "General"];
    const genre = genres[0] || "General";
    const langs = Array.isArray(ch.subchannel_names) ? ch.subchannel_names : [ch.subchannel_names || "All"];
    const lang = langs[0] || "All";

    // Filtering based on requested playlist type
    if (type === "sports") {
      const isSport = genres.some(g => String(g).toLowerCase().includes("sport")) ||
                      name.toLowerCase().includes("sport") ||
                      name.toLowerCase().includes("cricket");
      if (!isSport) continue;
    } else if (type === "tamil") {
      if (lang.toLowerCase() !== "tamil") continue;
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

    const proxyStreamUrl = `${host}/stream/${id}/manifest.mpd`;
    entries.push(
      `#EXTINF:-1 tvg-id="${id}" tvg-name="${name}" tvg-logo="${logo}" group-title="${lang} | ${genre}", ${name}\n` +
      kodiProp +
      `${proxyStreamUrl}\n`
    );
  }

  res.setHeader("Content-Type", "audio/x-mpegurl");
  res.setHeader("Content-Disposition", `inline; filename="${type}.m3u"`);
  res.send(header + entries.join("\n"));
});

// Stream manifest proxy with header injection & rewrite
app.get("/stream/:id/manifest.mpd", async (req, res) => {
  await refreshCacheIfNeeded();
  const id = req.params.id;
  const ch = channelsData.find(c => String(c.id) === id);

  if (!ch) {
    return res.status(404).send("Channel not found");
  }

  const streamData = ch.streamData || {};
  let targetUrl = streamData.dashWidewinePlayUrl || streamData.initialUrl;

  if (!targetUrl) {
    return res.status(404).send("Manifest URL not found");
  }

  // Handle Akamai host routing
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
    // If Akamai throws 400/403, redirect directly so player can try alternative route
    console.error(`[Stream Error ${id}]:`, err.message);
    res.redirect(targetUrl);
  }
});

app.listen(PORT, async () => {
  console.log(`[TataPlay Cloud Relay] Running on port ${PORT}`);
  await refreshCacheIfNeeded();
});
