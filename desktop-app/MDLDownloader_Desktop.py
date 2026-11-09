#!/usr/bin/env python3
"""
MDLDownloader Desktop — Medal.tv Video & Bulk Profile Downloader
100% English, Generic, Zero Personal Data.
Creates ONLY ~/Downloads/MyClips_<username>.zip (containing MyClips/<Game>/<Clip>.mp4 inside the ZIP)
or loose folders depending on user choice — never duplicates both!
"""

import os
import re
import json
import uuid
import shutil
import zipfile
import tempfile
import threading
import urllib.request
import urllib.parse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import tkinter as tk
from tkinter import ttk, filedialog, messagebox


DEFAULT_DOWNLOAD_DIR = str(Path.home() / "Downloads")


def sanitize_filename(name: str) -> str:
    clean = re.sub(r'[\\/*?:"<>|]', "_", (name or "Untitled")).strip()
    return clean[:75] if clean else "Untitled"


def create_guest_session() -> tuple[str, str]:
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Medal-User-Agent": "Medal-Nextjs/1.0 (simplified_signup)",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    body = json.dumps({
        "userName": "guest",
        "email": "guest",
        "password": str(uuid.uuid4()),
    }).encode("utf-8")
    req = urllib.request.Request("https://medal.tv/api/users", data=body, headers=headers, method="POST")
    res = json.loads(urllib.request.urlopen(req, timeout=20).read().decode("utf-8"))
    uid = res.get("auth", {}).get("userId") or res.get("user", {}).get("userId")
    key = res.get("auth", {}).get("key")
    return str(uid), str(key)


def resolve_user_id(profile_input: str, guest_auth: str) -> tuple[str, str]:
    clean = profile_input.strip()
    m = re.search(r"medal\.tv/(?:[a-zA-Z-]+/)?u/([^/?#]+)", clean, re.I)
    if m:
        clean = urllib.parse.unquote(m.group(1))
    if clean.isdigit():
        return clean, clean

    try:
        req = urllib.request.Request(
            f"https://medal.tv/api/users?username={urllib.parse.quote(clean)}",
            headers={
                "User-Agent": "Mozilla/5.0",
                "Medal-User-Agent": "Medal-Nextjs/1.0 (simplified_signup)",
                "X-Authentication": guest_auth,
                "Accept": "application/json",
            },
        )
        data = json.loads(urllib.request.urlopen(req, timeout=15).read().decode("utf-8"))
        if isinstance(data, list) and len(data) > 0 and data[0].get("userId"):
            return str(data[0]["userId"]), data[0].get("userName", clean)
    except Exception:
        pass

    req = urllib.request.Request(f"https://medal.tv/u/{urllib.parse.quote(clean)}", headers={"User-Agent": "Mozilla/5.0"})
    html = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", errors="ignore")
    uid_m = re.search(r'\\"userId\\":\\"?(\d+)\\"?', html) or re.search(r'"userId":"?(\d+)"?', html)
    if uid_m:
        return uid_m.group(1), clean
    raise ValueError(f"Could not find profile for '{clean}'.")


class MDLDownloaderApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("MDLDownloader — Medal.tv Video & Profile Downloader")
        self.geometry("780x600")
        self.configure(bg="#121316")
        self.resizable(True, True)

        self.is_running = False
        self.cancel_requested = False

        self._build_ui()

    def _build_ui(self):
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure(
            "Gold.Horizontal.TProgressbar",
            thickness=12,
            troughcolor="#0c0d0f",
            background="#f5b800",
            bordercolor="#262930",
            lightcolor="#f5b800",
            darkcolor="#f5b800",
        )

        # Top Navbar (Black + Gold MDL badge)
        navbar = tk.Frame(self, bg="#0c0d0f", padx=22, pady=12, highlightthickness=1, highlightbackground="#22252a")
        navbar.pack(fill="x")

        logo_frame = tk.Frame(navbar, bg="#0c0d0f")
        logo_frame.pack(side="left")
        tk.Label(
            logo_frame,
            text=" MDL ",
            font=("Impact", 16),
            fg="#0c0d0f",
            bg="#f5b800",
        ).pack(side="left", padx=(0, 5))
        tk.Label(
            logo_frame,
            text="DOWNLOADER",
            font=("Impact", 16),
            fg="#ffffff",
            bg="#0c0d0f",
        ).pack(side="left")

        tk.Label(
            navbar,
            text="Medal.tv Bulk Video & ZIP Downloader",
            font=("Segoe UI", 9, "bold"),
            fg="#9ca3af",
            bg="#0c0d0f",
        ).pack(side="right")

        # Hero Banner Section
        hero = tk.Frame(self, bg="#181a20", padx=22, pady=18, highlightthickness=1, highlightbackground="#262930")
        hero.pack(fill="x")

        title_row = tk.Frame(hero, bg="#181a20")
        title_row.pack(anchor="w")
        tk.Label(title_row, text="Medal.tv ", font=("Segoe UI", 15, "bold"), fg="#f5b800", bg="#181a20").pack(side="left")
        tk.Label(title_row, text="Video & Profile Downloader", font=("Segoe UI", 15, "bold"), fg="#ffffff", bg="#181a20").pack(side="left")

        tk.Label(
            hero,
            text="No Watermark. Single MyClips_<username>.zip Output. High Quality.",
            font=("Segoe UI", 9),
            fg="#9ca3af",
            bg="#181a20",
        ).pack(anchor="w", pady=(2, 12))

        # Joined Search Bar [Profile / User] [Input] [Download]
        bar = tk.Frame(hero, bg="#32363f", bd=1)
        bar.pack(fill="x")

        tk.Label(
            bar,
            text=" Profile / User ",
            font=("Segoe UI", 9, "bold"),
            fg="#e4e6eb",
            bg="#252830",
            padx=10,
            pady=8,
        ).pack(side="left")

        self.profile_var = tk.StringVar()
        self.profile_entry = tk.Entry(
            bar,
            textvariable=self.profile_var,
            font=("Segoe UI", 10),
            bg="#ffffff",
            fg="#111827",
            insertbackground="#111827",
            relief="flat",
        )
        self.profile_entry.pack(side="left", fill="both", expand=True, ipady=7, padx=(1, 1))

        self.start_btn = tk.Button(
            bar,
            text="Download",
            command=self._start_backup,
            bg="#f5b800",
            fg="#0c0d0f",
            activebackground="#ffca28",
            activeforeground="#0c0d0f",
            font=("Segoe UI", 10, "bold"),
            relief="flat",
            padx=22,
            cursor="hand2",
        )
        self.start_btn.pack(side="right", fill="y")

        # Settings Form
        form = tk.Frame(self, bg="#121316", padx=22, pady=14)
        form.pack(fill="x")

        tk.Label(
            form,
            text="Optional Session Key (For Private Clips or 'Require Login to Watch' Profiles):",
            font=("Segoe UI", 9, "bold"),
            fg="#d1d5db",
            bg="#121316",
        ).grid(row=0, column=0, sticky="w", pady=(0, 4))

        self.key_var = tk.StringVar()
        tk.Entry(
            form,
            textvariable=self.key_var,
            font=("Segoe UI", 9),
            bg="#181a20",
            fg="#ffffff",
            insertbackground="#ffffff",
            relief="flat",
            highlightthickness=1,
            highlightbackground="#32363f",
            show="*",
        ).grid(row=1, column=0, columnspan=2, sticky="we", ipady=5, pady=(0, 10))

        tk.Label(
            form,
            text="Output Directory (Default: Downloads -> saves MyClips_<username>.zip here):",
            font=("Segoe UI", 9, "bold"),
            fg="#d1d5db",
            bg="#121316",
        ).grid(row=2, column=0, sticky="w", pady=(0, 4))

        self.dir_var = tk.StringVar(value=DEFAULT_DOWNLOAD_DIR)
        tk.Entry(
            form,
            textvariable=self.dir_var,
            font=("Segoe UI", 9),
            bg="#181a20",
            fg="#ffffff",
            insertbackground="#ffffff",
            relief="flat",
            highlightthickness=1,
            highlightbackground="#32363f",
        ).grid(row=3, column=0, sticky="we", ipady=5)

        tk.Button(
            form,
            text="Browse Folder",
            command=self._choose_dir,
            bg="#252830",
            fg="#e4e6eb",
            activebackground="#32363f",
            activeforeground="#ffffff",
            font=("Segoe UI", 9),
            relief="flat",
            padx=12,
            pady=4,
        ).grid(row=3, column=1, sticky="e", padx=(8, 0))

        form.columnconfigure(0, weight=1)

        # Checkboxes & Controls Row
        opts = tk.Frame(self, bg="#121316", padx=22, pady=2)
        opts.pack(fill="x")

        self.organize_by_game_var = tk.BooleanVar(value=True)
        tk.Checkbutton(
            opts,
            text="Organize by Game Subfolders (MyClips/GameName/clip.mp4)",
            variable=self.organize_by_game_var,
            bg="#121316",
            fg="#d1d5db",
            selectcolor="#181a20",
            activebackground="#121316",
            activeforeground="#ffffff",
            font=("Segoe UI", 9),
        ).pack(side="left", padx=(0, 18))

        self.create_zip_var = tk.BooleanVar(value=True)
        tk.Checkbutton(
            opts,
            text="Save as Single MyClips_<username>.zip (Uncheck for unpacked folder)",
            variable=self.create_zip_var,
            bg="#121316",
            fg="#f5b800",
            selectcolor="#181a20",
            activebackground="#121316",
            activeforeground="#f5b800",
            font=("Segoe UI", 9, "bold"),
        ).pack(side="left")

        self.open_folder_btn = tk.Button(
            opts,
            text="Open Downloads",
            command=self._open_dir,
            bg="#252830",
            fg="#e4e6eb",
            font=("Segoe UI", 8),
            relief="flat",
            padx=10,
            pady=3,
        )
        self.open_folder_btn.pack(side="right")

        self.cancel_btn = tk.Button(
            opts,
            text="Cancel",
            command=self._cancel_backup,
            bg="#32363f",
            fg="#ef4444",
            font=("Segoe UI", 8, "bold"),
            relief="flat",
            padx=10,
            pady=3,
            state="disabled",
        )
        self.cancel_btn.pack(side="right", padx=(0, 8))

        # Progress & Log Area
        prog_frame = tk.Frame(self, bg="#121316", padx=22, pady=10)
        prog_frame.pack(fill="both", expand=True)

        self.progress = ttk.Progressbar(
            prog_frame,
            style="Gold.Horizontal.TProgressbar",
            orient="horizontal",
            mode="determinate",
        )
        self.progress.pack(fill="x", pady=(0, 8))

        self.log_box = tk.Text(
            prog_frame,
            bg="#0c0d0f",
            fg="#cbd5e1",
            font=("Consolas", 9),
            relief="flat",
            highlightthickness=1,
            highlightbackground="#22252a",
            height=11,
        )
        self.log_box.pack(fill="both", expand=True)
        self._log("MDLDownloader Ready. Enter a Medal.tv username or profile link above and click Download.")

    def _choose_dir(self):
        chosen = filedialog.askdirectory(initialdir=self.dir_var.get())
        if chosen:
            self.dir_var.set(chosen)

    def _open_dir(self):
        target = self.dir_var.get().strip() or DEFAULT_DOWNLOAD_DIR
        os.makedirs(target, exist_ok=True)
        try:
            os.startfile(target)
        except Exception:
            pass

    def _log(self, msg: str):
        self.log_box.insert("end", msg + "\n")
        self.log_box.see("end")

    def _start_backup(self):
        profile = self.profile_var.get().strip()
        if not profile:
            messagebox.showwarning("MDLDownloader", "Please enter a Medal.tv username or profile link.")
            return
        self.is_running = True
        self.cancel_requested = False
        self.start_btn.config(state="disabled", text="Downloading...")
        self.cancel_btn.config(state="normal")
        self.progress["value"] = 0
        threading.Thread(target=self._worker_thread, daemon=True).start()

    def _cancel_backup(self):
        self.cancel_requested = True
        self._log("Cancelling active downloads...")

    def _worker_thread(self):
        staging_dir = None
        try:
            profile_in = self.profile_var.get().strip()
            custom_key = self.key_var.get().strip()
            base_out_dir = self.dir_var.get().strip() or DEFAULT_DOWNLOAD_DIR
            os.makedirs(base_out_dir, exist_ok=True)

            self.after(0, lambda: self._log("Connecting to Medal.tv API..."))
            guest_uid, guest_key = create_guest_session()
            guest_auth = f"{guest_uid},{guest_key}"

            self.after(0, lambda: self._log(f"Resolving profile '{profile_in}'..."))
            user_id, username = resolve_user_id(profile_in, guest_auth)
            clean_user = sanitize_filename(username)
            self.after(0, lambda: self._log(f"Found user: @{username} (ID: {user_id})"))

            auth_header = f"{user_id},{custom_key}" if custom_key else guest_auth
            priv_modes = ["", "&privacy=0"] if custom_key else ["&privacy=0"]

            headers = {
                "User-Agent": "Mozilla/5.0",
                "Medal-User-Agent": "Medal-Nextjs/1.0 (simplified_signup)",
                "X-Authentication": auth_header,
                "Accept": "application/json",
            }

            all_clips = []
            seen = set()
            for priv in priv_modes:
                offset = 0
                while not self.cancel_requested:
                    url = f"https://medal.tv/api/content?userId={user_id}{priv}&limit=50&offset={offset}&sortDirection=DESC"
                    req = urllib.request.Request(url, headers=headers)
                    batch = json.loads(urllib.request.urlopen(req, timeout=30).read().decode("utf-8"))
                    if not isinstance(batch, list) or not batch:
                        break
                    for c in batch:
                        cid = c.get("contentId")
                        if cid and cid not in seen:
                            seen.add(cid)
                            all_clips.append(c)
                    self.after(0, lambda n=len(all_clips): self._log(f"Loaded {n} clips..."))
                    if len(batch) < 50:
                        break
                    offset += 50

            if not all_clips:
                self.after(0, lambda: self._log("No clips found on this profile."))
                return

            zip_mode = self.create_zip_var.get()
            if zip_mode:
                # Use temporary staging directory so we only produce a clean MyClips_<username>.zip!
                staging_dir = tempfile.mkdtemp(prefix="mdldownloader_")
                work_dir = staging_dir
            else:
                work_dir = os.path.join(base_out_dir, f"MyClips_{clean_user}")
                os.makedirs(work_dir, exist_ok=True)

            self.after(0, lambda: self._log(f"Starting 8x parallel download ({len(all_clips)} clips)..."))
            completed = 0
            downloaded_files = []
            lock = threading.Lock()

            def download_one(idx_clip):
                idx, clip = idx_clip
                if self.cancel_requested:
                    return None
                cid = clip.get("contentId")
                title = sanitize_filename(clip.get("contentTitle") or "Untitled")
                game = sanitize_filename((clip.get("category") or {}).get("categoryName") or "General")

                video_url = None
                for field in ["rawFileUrl", "contentUrl", "contentUrl1080p", "contentUrl720p", "contentUrl480p", "socialMediaVideo"]:
                    val = clip.get(field)
                    if val and "privacy-protected-guest" not in val and not val.endswith("&missing"):
                        video_url = val
                        break

                if not video_url:
                    return f"[{idx+1}/{len(all_clips)}] SKIPPED (Session Key Required): {title}"

                target_folder = os.path.join(work_dir, game) if self.organize_by_game_var.get() else work_dir
                os.makedirs(target_folder, exist_ok=True)
                fname = f"{idx+1:03d}_{title}_{cid}.mp4"
                fpath = os.path.join(target_folder, fname)

                if os.path.exists(fpath) and os.path.getsize(fpath) > 10000:
                    with lock:
                        downloaded_files.append(fpath)
                    return f"[{idx+1}/{len(all_clips)}] READY: {fname}"

                req = urllib.request.Request(video_url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=120) as r:
                    part = fpath + ".part"
                    with open(part, "wb") as f:
                        while not self.cancel_requested:
                            chunk = r.read(1024 * 512)
                            if not chunk:
                                break
                            f.write(chunk)
                if not self.cancel_requested:
                    os.replace(part, fpath)
                    with lock:
                        downloaded_files.append(fpath)
                    return f"[{idx+1}/{len(all_clips)}] DOWNLOADED: {fname}"
                return None

            with ThreadPoolExecutor(max_workers=8) as pool:
                futures = [pool.submit(download_one, (i, c)) for i, c in enumerate(all_clips)]
                for fut in as_completed(futures):
                    res_msg = fut.result()
                    completed += 1
                    pct = (completed / len(all_clips)) * 100
                    self.after(0, lambda p=pct, m=res_msg: (self.progress.configure(value=p), self._log(m) if m else None))

            if not self.cancel_requested and downloaded_files:
                if zip_mode:
                    zip_filename = f"MyClips_{clean_user}.zip"
                    zip_path = os.path.join(base_out_dir, zip_filename)
                    self.after(0, lambda: self._log(f"\nBuilding {zip_path} (with internal MyClips/ folder)..."))
                    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED) as zf:
                        for fp in sorted(downloaded_files):
                            if os.path.exists(fp):
                                rel = os.path.relpath(fp, work_dir)
                                zf.write(fp, arcname=os.path.join("MyClips", rel))
                    self.after(0, lambda: self._log(f"\n✅ COMPLETED! Single archive saved at:\n👉 {zip_path}"))
                else:
                    self.after(0, lambda: self._log(f"\n✅ COMPLETED! {len(downloaded_files)} clips saved in:\n👉 {work_dir}"))
            elif not self.cancel_requested:
                self.after(0, lambda: self._log("\n⚠️ No unlocked clips could be downloaded. Add a Session Key if clips are protected."))
        except Exception as e:
            self.after(0, lambda err=str(e): self._log(f"❌ Error: {err}"))
        finally:
            if staging_dir and os.path.exists(staging_dir):
                try:
                    shutil.rmtree(staging_dir, ignore_errors=True)
                except Exception:
                    pass
            self.is_running = False
            self.after(0, lambda: (self.start_btn.config(state="normal", text="Download"), self.cancel_btn.config(state="disabled")))


if __name__ == "__main__":
    app = MDLDownloaderApp()
    app.mainloop()
