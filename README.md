<div align="center">

# 🎮 `[MDL]` DOWNLOADER

### Bulk Medal.tv Video & Profile Downloader — No Watermark • Original 1080p MP4 • Single `MyClips.zip`

[![Live Web App](https://img.shields.io/badge/Live_Web_App-Use_Online-2ea043?style=for-the-badge&logo=googlechrome&logoColor=white)](https://mdldownloader.onrender.com/)
[![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-f5b800?style=for-the-badge&logo=googlechrome&logoColor=black)](#2-chrome-extension-1-click-session--full-tab-downloader)
[![Windows EXE](https://img.shields.io/badge/Windows_Desktop-Native_C%23_WebView2-0078D6?style=for-the-badge&logo=windows&logoColor=white)](#3-windows-desktop-app-native-c-webview2-exe)
[![VirusTotal](https://img.shields.io/badge/VirusTotal-SHA256_Verified-4ade80?style=for-the-badge&logo=virustotal&logoColor=black)](#-security-transparency--sha-256--virustotal-verification)
[![License: MIT](https://img.shields.io/badge/License-MIT-9aa0ac?style=for-the-badge)](#license)

**MDLDownloader** is a 100% open-source 3-in-1 toolkit to back up and bulk-download your gaming clips from **Medal.tv** in original full-HD quality without watermarks, automatically organized into game subfolders inside a single `MyClips_<username>.zip` archive.

[🌐 Open Web App ↗](https://mdldownloader.onrender.com/) • [🧩 Browser Extension](#2-chrome-extension-1-click-session--full-tab-downloader) • [💻 Windows Desktop `.EXE`](#3-windows-desktop-app-native-c-webview2-exe) • [🛡️ Security & VirusTotal](#-security-transparency--sha-256--virustotal-verification)

</div>

---

## 🖼️ Web Application Preview

![MDLDownloader Web App Preview](./assets/web-preview.svg)

---

## 🧩 Browser Extension & Native C# Desktop `.EXE` Preview

![MDLDownloader Extension and Desktop Preview](./assets/extension-preview.svg)

---

## ✨ Why MDLDownloader?

Gamers accumulate **hundreds or thousands of clips** across multiple games (*Counter-Strike 2, Valorant, EA SPORTS FC, GTA V, Call of Duty, League of Legends*, etc.). Downloading them one by one in a browser takes hours, and guest-protected or private clips require an active session.

**MDLDownloader** solves this with **three complementary tools in one repository**:

| Platform | Best For | Key Highlights |
| :--- | :--- | :--- |
| 🌐 **Web App** ([`web/`](./web)) | Instant browser access on any OS | Enter username/URL, hover-preview clips directly from Medal CDN, filter by game/date, Shift+Click range select, 36-clip pagination, and stream a single `MyClips_<user>.zip` (ZIP64) or save directly to a local folder. |
| 🧩 **Browser Extension** ([`chrome-extension/`](./chrome-extension)) | 1-click session detection + Full-Tab ZIP | Automatically detects your logged-in `@username` on `medal.tv` with a 1-click **My Clips** button, filters by game, and packages a single `MyClips.zip` inside a dedicated full-page tab (`downloader.html`) so switching tabs never interrupts downloads. |
| 💻 **Windows Desktop App** ([`desktop-app/`](./desktop-app)) | Massive libraries (500–2,000+ clips) | Native C# (`.NET Framework 4.8`) **Edge WebView2** desktop app (`1.0 MB`) powered by an **8-thread parallel download engine**, visual clip grid, hover video previews, Game & Date filters, Resume, Retry Failed, and single `MyClips_<user>.zip` output. |

---

## 🛡️ Security, Transparency & SHA-256 / VirusTotal Verification

We built **MDLDownloader** to be completely transparent, auditable, and safe for every gamer:

1. **100% Open Source & Readable Code:**
   - **Desktop App Source:** Written in a single, plain-text C# file ([`desktop-app/Program.cs`](./desktop-app/Program.cs)) paired with an HTML/CSS/JS interface ([`desktop-app/ui.html`](./desktop-app/ui.html)) and official Microsoft-signed WebView2 libraries ([`desktop-app/lib/`](./desktop-app/lib)).
   - **Web & Extension Source:** Zero obfuscation, zero external npm dependencies ([`package.json`](./package.json)), and strict domain whitelisting (`*.medal.tv` / `cdn.medal.tv`) on video streams.
2. **Zero Credential or Session Storage:**
   - If you optionally use a `medal-auth` session cookie/key to unlock your own private or guest-protected clips, it is sent strictly over HTTPS to `medal.tv` for that request only. Keys are **never** logged, saved to a database, or shared with third parties.
3. **Public VirusTotal Scan & SHA-256 Checksum (`MDLDownloader.exe`):**
   - **Executable Path:** [`web/public/downloads/MDLDownloader.exe`](./web/public/downloads/MDLDownloader.exe) (`1,009,152` bytes / `1.0 MB`)
   - **SHA-256 Hash:** `a8654191811d6591cf41fa6def4622da1f5ddcd2c3f6d29cf6a84263e709b015`
   - **VirusTotal Report:** [**View Official VirusTotal Analysis ↗**](https://www.virustotal.com/gui/file/a8654191811d6591cf41fa6def4622da1f5ddcd2c3f6d29cf6a84263e709b015)

You can verify the downloaded `.EXE` hash on Windows PowerShell in one second:

```powershell
Get-FileHash .\MDLDownloader.exe -Algorithm SHA256
```

> **Prefer to compile the `.EXE` yourself from source?**
> You don't even need Visual Studio or Python — Windows includes the official Microsoft C# compiler (`csc.exe`) out of the box:
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\desktop-app\build.ps1
> ```

---

## 🚀 Quick Start Guide

### 1. Web Application (Instant Online Tool)

No installation required — use the live web app directly in any desktop or mobile browser:

👉 **[Open MDLDownloader Web App ↗](https://mdldownloader.onrender.com/)**

- **Public Clips:** Enter any Medal username or `https://medal.tv/u/<username>` and click **Fetch Clips**.
- **Protected / Private Clips:** Click any locked clip card (`🔒 Session Key Required`) or expand **Unlock Private or Guest-Protected Clips** to copy your `medal-auth` cookie from `F12 -> Application -> Cookies -> medal.tv` (or use the Browser Extension for automatic 1-click detection).
- **Save Options:** Click **Download MyClips.zip** for a single ZIP64 archive, **Save to Local Folder** for direct folder saving with resume support, or **Download MP4** on individual clips.

---

### 2. Chrome Extension (1-Click Session & Full-Tab Downloader)

Works directly inside **Chrome, Brave, Edge, or Opera** without running a local server:

1. Download [`web/public/downloads/MDLDownloader-Chrome-Extension.zip`](./web/public/downloads/MDLDownloader-Chrome-Extension.zip) and unzip it (or select the [`chrome-extension/`](./chrome-extension) folder directly).
2. Open `chrome://extensions/` in your browser.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the unzipped extension folder.
5. Click the **MDLDownloader** icon in your browser toolbar:
   - If you are logged into `medal.tv`, click **My Clips** next to `Logged in as @username`, or enter any username/URL and click **Fetch Clips**.
   - Select the games you want and click **Open Full Downloader ↗** to download a single `MyClips_<username>.zip` or save directly to a local folder with resume support.

---

### 3. Windows Desktop App (Native C# WebView2 `.EXE`)

Built for maximum speed on large clip libraries (`500–2,000+` clips):

1. Download and run **[`web/public/downloads/MDLDownloader.exe`](./web/public/downloads/MDLDownloader.exe)**.
2. Enter your Medal Profile URL or Username and click **Fetch Clips**.
3. *(Optional)* Expand the Session Key box and paste your `medal-auth` cookie or `mdl_...` key to unlock guest-protected/private clips.
4. Filter by **Game**, **Date Range**, or search by title, choose your output directory (defaults to `Downloads`), and click **Download MyClips.zip** or **Save to Local Folder**.

---

## 📂 Project Structure

```text
MDLDownloader/
├── assets/
│   ├── web-preview.svg               # Web application UI preview graphic
│   └── extension-preview.svg         # Browser Extension & Native C# Desktop UI preview
├── chrome-extension/                 # Standalone Manifest V3 Browser Extension
│   ├── icons/                        # Gold MDL toolbar & extension icons (16/48/128px)
│   ├── manifest.json                 # Extension permissions & Manifest V3 config
│   ├── shared.js                     # Shared Medal.tv API & profile scanner helpers
│   ├── popup.html & popup.js         # Logged-in @username + "My Clips" & game picker popup
│   ├── downloader.html & .js         # Dedicated full-page downloader tab (ZIP64 + Folder Resume)
│   └── client-zip.js                 # Zero-dependency streaming ZIP64 generator
├── desktop-app/                      # Native C# (.NET 4.8) Edge WebView2 + 8-Thread Desktop App
│   ├── app.ico                       # Multi-resolution Windows application icon
│   ├── app.manifest                  # High-DPI & standard user execution manifest
│   ├── build.ps1                     # Zero-dependency csc.exe build & sync script
│   ├── lib/                          # Official Microsoft-signed WebView2 assemblies
│   ├── Program.cs                    # Native C# WebView2 RPC bridge & 8-thread ZIP64 engine
│   └── ui.html                       # Modern HTML5/CSS3 dark & gold desktop interface
├── web/                              # Zero-Dependency Node.js Web Application
│   ├── server.js                     # HTTP server, SSE progress & domain-whitelisted proxy
│   ├── zip-stream.js                 # Server-side streaming ZIP64 archive writer
│   └── public/
│       ├── index.html                # Main Web UI, Cookie Guide, Tool Cards & Privacy Policy
│       ├── app.js                    # Client-side filters, pagination, locked-clip UI & SSE
│       ├── og-image.png              # Social sharing banner (1200x630 PNG)
│       ├── favicon.svg               # Gold MDL vector favicon
│       └── downloads/                # Direct downloadable MDLDownloader.exe & Extension .ZIP
├── package.json                      # Zero-dependency Node.js configuration
├── render.yaml                       # Render.com cloud deployment blueprint
└── README.md                         # Project documentation & security verification
```

---

## 🔒 Privacy & Legal Disclaimer

- **No Personal Data Collected:** MDLDownloader does not collect, store, or transmit user credentials, session tokens, or IP addresses to any database.
- **Independent Project:** MDLDownloader is an independent open-source archiving utility created for gamers to back up their own clips and is **not** affiliated with, endorsed by, or connected to Medal B.V. (`medal.tv`).

---

## 📄 License

Distributed under the **MIT License**. Free to use, audit, modify, and self-host.
