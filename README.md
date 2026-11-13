<div align="center">

# 🎮 `[MDL]` DOWNLOADER

### Bulk Medal.tv Video Downloader — No Watermark • Original 1080p MP4 • Game Subfolder `.ZIP`

[![Node.js](https://img.shields.io/badge/Node.js-Zero_Dependencies-2ea043?style=for-the-badge&logo=nodedotjs&logoColor=white)](#)
[![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-f5b800?style=for-the-badge&logo=googlechrome&logoColor=black)](#2-chrome-extension-in-popup-game-selector)
[![Windows EXE](https://img.shields.io/badge/Windows_Desktop-.EXE_Included-0078D6?style=for-the-badge&logo=windows&logoColor=white)](#3-windows-desktop-app-standalone-exe)
[![License: MIT](https://img.shields.io/badge/License-MIT-9aa0ac?style=for-the-badge)](#license)

**MDLDownloader** is a complete 3-in-1 open-source toolkit to back up and bulk-download your gaming clips from **Medal.tv** in original full-HD quality without watermarks, automatically sorted into game folders inside a single `MyClips_<username>.zip` archive.

[🌐 Web App](#1-web-application-zero-dependency-nodejs) • [🧩 Chrome Extension](#2-chrome-extension-in-popup-game-selector) • [💻 Windows Desktop `.EXE`](#3-windows-desktop-app-standalone-exe) • [🚀 1-Click Cloud Deploy](#deploy-your-own-instance-free)

</div>

---

## 🖼️ Web Application Preview

![MDLDownloader Web App Preview](./assets/web-preview.svg)

---

## 🧩 Chrome Extension & Desktop `.EXE` Preview

![MDLDownloader Extension and Desktop Preview](./assets/extension-preview.svg)

---

## ✨ Why MDLDownloader?

Gamers often accumulate **hundreds of clips** across multiple games (Counter-Strike 2, Valorant, EA SPORTS FC / FIFA, GTA V, League of Legends, etc.). Downloading them one by one through a browser takes hours, and guest-protected clips often fail to download without a valid session.

**MDLDownloader** solves this with **three tools in one repository**:

| Platform | Best For | Key Features |
| :--- | :--- | :--- |
| 🌐 **Web App** (`web/`) | Instant browser access on any OS | Enter username/URL, hover-preview clips, filter by game/date, Shift+Click range select, 36-clip pagination, and stream a single `MyClips_<user>.zip` (ZIP64) or save to folder. |
| 🧩 **Chrome Extension** (`chrome-extension/`) | 1-click session detection + Full-Tab downloader | Displays `Logged in as @username` + **My Clips** button, filters by game, and packages a single `MyClips.zip` in a full-page tab (`downloader.html`) so switching tabs never cancels downloads. |
| 💻 **Desktop App** (`desktop-app/`) | Massive libraries (500–2,000+ clips) | Native C# (.NET) **Edge WebView2** desktop app (<1 MB) backed by an **8-thread download engine** with clip thumbnails, hover previews, Game & Date filters, Resume, Retry Failed, and ZIP64 output. |

---

## 🛠️ How It Works & Features

- **Original Direct MP4 Streams:** Fetches the highest available resolution (`rawFileUrl` -> `contentUrl` -> `1080p` -> `720p`) directly from Medal's CDN without re-encoding or adding watermarks.
- **Game Subfolder Organization:** Automatically groups clips by category (e.g., `MyClips/Counter-Strike 2/0001_Ace_Clutch_12345.mp4`, or flattened if unchecked).
- **Zero-Code Private Clip Access:** Paste your `medal-auth` cookie directly from DevTools (`Application -> Cookies`), or use the Browser Extension — no console pasting required.
- **Single-File ZIP64 Streaming:** Web app uses zero-dependency server-side ZIP64 streaming (`zip-stream.js`), and the Extension uses `client-zip.js` — preventing multi-prompt spam or split archives.
- **100% Open Source & Privacy-First:** Session tokens are never stored, logged, or saved to disk.

---

## 🚀 Quick Start Guide

### 1. Web Application (Zero-Dependency Node.js)

The web application requires **only Node.js (18+)** — no external `npm install` packages are needed!

```bash
# Clone the repository
git clone https://github.com/yigittsahbaz/MDLDownloader.git
cd MDLDownloader

# Start the web server
npm start
```

Open **`http://localhost:3000`** in your browser.

- **Public Clips:** Enter any Medal username or `https://medal.tv/u/<username>` and click **Fetch Clips**.
- **Protected / Private Clips:** Expand **Unlock Private or Guest-Protected Clips**, copy your `medal-auth` cookie value from `F12 -> Application -> Cookies -> medal.tv`, or use the Browser Extension.

---

### 2. Chrome Extension (Full-Page Downloader Tab)

No web server needed — works directly inside Chrome, Brave, Edge, or Opera:

1. Download [`web/public/downloads/MDLDownloader-Chrome-Extension.zip`](./web/public/downloads/MDLDownloader-Chrome-Extension.zip) (or use the [`chrome-extension/`](./chrome-extension) folder directly).
2. Open Chrome/Brave and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the extracted extension folder.
5. Click the **MDLDownloader** icon in your toolbar:
   - If logged into `medal.tv`, click **My Clips** next to `Logged in as @username`, or scan any public username/URL.
   - Check the games you want and click **Open Full Downloader ↗** to download a single `MyClips_<username>.zip` in a dedicated tab.

---

### 3. Windows Desktop App (Modern WebView2 `.EXE`)

For maximum speed on large clip libraries:

1. Download and run **[`web/public/downloads/MDLDownloader.exe`](./web/public/downloads/MDLDownloader.exe)** (also available on the Web App homepage with SHA-256 verification).
2. Enter your Medal Profile URL or Username and click **Fetch Clips**.
3. (Optional) Paste your `medal-auth` cookie value or `mdl_...` key for private/guest-protected clips.
4. Filter by Game or Date, verify your target folder (defaults to `Downloads`), and click **Download Selected**.

> **Want to build the `.EXE` from source yourself?** *(Requires only built-in Windows .NET Framework 4.x — no Python or Visual Studio needed)*
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\desktop-app\build.ps1
> ```

---

## ☁️ Deploy Your Own Instance (Free)

This repository includes a [`render.yaml`](./render.yaml) blueprint and [`package.json`](./package.json) for instant cloud deployment on **Render**, **Railway**, or **Fly.io**:

1. Push this repository to your GitHub account.
2. Go to [Render.com](https://render.com) -> **New Web Service** -> Connect your GitHub repository.
3. Render will automatically detect `npm start` (`node web/server.js`) and deploy your site live with free HTTPS.

---

## 📂 Project Structure

```text
MDLDownloader/
├── assets/
│   ├── web-preview.svg               # Web UI preview graphic
│   └── extension-preview.svg         # Chrome Extension & Desktop .EXE preview
├── chrome-extension/                 # Standalone Manifest V3 Chrome Extension
│   ├── icons/                        # Gold MDL toolbar & extension icons (16/48/128px)
│   ├── manifest.json                 # Extension permissions & config
│   ├── shared.js                     # Shared Medal.tv API helpers
│   ├── popup.html & popup.js         # Logged-in @user + "My Clips" & game picker popup
│   ├── downloader.html & .js         # Dedicated full-page downloader tab
│   └── client-zip.js                 # Local ZIP64 generator for single-file archives
├── desktop-app/                      # Native C# WebView2 + 8-Thread Desktop App
│   ├── app.ico                       # Multi-resolution Windows app icon
│   ├── app.manifest                  # DPI & standard user execution manifest
│   ├── build.ps1                     # Zero-dependency csc.exe build script
│   ├── lib/                          # Official Microsoft-signed WebView2 assemblies
│   ├── Program.cs                    # Native C# WebView2 bridge & 8-thread ZIP64 engine
│   └── ui.html                       # Modern HTML5/CSS3 dark & gold desktop UI
├── web/                              # TikWM-style Web Application
│   ├── server.js                     # Zero-dependency Node.js server, SSE & whitelist proxy
│   ├── zip-stream.js                 # Zero-dependency server-side ZIP64 stream writer
│   └── public/
│       ├── index.html                # Main UI, Cookie Guide, Tool Cards & Privacy Policy
│       ├── app.js                    # Client-side filters, pagination, hover & SSE progress
│       ├── og-image.png              # Social preview banner (1200x630 PNG)
│       ├── favicon.svg               # Gold MDL favicon
│       └── downloads/                # Direct downloadable .EXE & Extension .ZIP packages
├── package.json                      # Node.js entry point for cloud hosting
├── render.yaml                       # 1-click Render.com free deployment config
└── README.md                         # Project documentation
```

---

## 🔒 Privacy & Legal Disclaimer

- **No Personal Data Collected:** MDLDownloader does not store, log, or transmit user credentials, session tokens, or IP addresses to any database.
- **Independent Tool:** MDLDownloader is an independent archiving utility created for users to back up their own gaming clips and is **not** affiliated with, endorsed by, or connected to Medal B.V. (`medal.tv`).

---

## 📄 License

Distributed under the **MIT License**. Free to use, modify, and self-host.
