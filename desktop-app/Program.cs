using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("MDLDownloader")]
[assembly: AssemblyDescription("MDLDownloader - Bulk Medal.tv Clip Downloader")]
[assembly: AssemblyConfiguration("")]
[assembly: AssemblyCompany("MDLDownloader Open Source")]
[assembly: AssemblyProduct("MDLDownloader Desktop")]
[assembly: AssemblyCopyright("MIT License - Open Source")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace MDLDownloader
{
    internal static class Program
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr LoadLibrary(string lpFileName);

        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        private static readonly string AppDataRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "MDLDownloader"
        );

        [STAThread]
        private static void Main()
        {
            try { SetProcessDPIAware(); } catch { }

            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12 | (SecurityProtocolType)3072;
            ServicePointManager.DefaultConnectionLimit = 64;

            AppDomain.CurrentDomain.AssemblyResolve += OnAssemblyResolve;
            EnsureNativeWebView2Loader();

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }

        private static Assembly OnAssemblyResolve(object sender, ResolveEventArgs args)
        {
            string simpleName = new AssemblyName(args.Name).Name;
            if (simpleName == "Microsoft.Web.WebView2.Core" || simpleName == "Microsoft.Web.WebView2.WinForms")
            {
                byte[] data = ReadEmbeddedResource(simpleName + ".dll");
                if (data != null)
                {
                    return Assembly.Load(data);
                }
            }
            return null;
        }

        private static void EnsureNativeWebView2Loader()
        {
            try
            {
                byte[] dllBytes = ReadEmbeddedResource("WebView2Loader.dll");
                if (dllBytes == null || dllBytes.Length == 0) return;

                Directory.CreateDirectory(AppDataRoot);
                string targetPath = Path.Combine(AppDataRoot, "WebView2Loader.dll");
                bool needWrite = true;

                if (File.Exists(targetPath))
                {
                    using (SHA256 sha = SHA256.Create())
                    {
                        byte[] expected = sha.ComputeHash(dllBytes);
                        using (FileStream fs = File.OpenRead(targetPath))
                        {
                            byte[] actual = sha.ComputeHash(fs);
                            if (BytesEqual(expected, actual)) needWrite = false;
                        }
                    }
                }

                if (needWrite)
                {
                    File.WriteAllBytes(targetPath, dllBytes);
                }
                LoadLibrary(targetPath);
            }
            catch
            {
                // Fallback if already loaded or present next to executable
            }
        }

        private static bool BytesEqual(byte[] a, byte[] b)
        {
            if (a == null || b == null || a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++)
            {
                if (a[i] != b[i]) return false;
            }
            return true;
        }

        internal static byte[] ReadEmbeddedResource(string resourceName)
        {
            Assembly asm = Assembly.GetExecutingAssembly();
            using (Stream s = asm.GetManifestResourceStream(resourceName))
            {
                if (s == null) return null;
                byte[] buf = new byte[s.Length];
                int read = 0;
                while (read < buf.Length)
                {
                    int n = s.Read(buf, read, buf.Length - read);
                    if (n <= 0) break;
                    read += n;
                }
                return buf;
            }
        }

        internal static string ReadEmbeddedText(string resourceName)
        {
            byte[] data = ReadEmbeddedResource(resourceName);
            return data == null ? string.Empty : Encoding.UTF8.GetString(data);
        }
    }

    internal sealed class MainForm : Form
    {
        private static readonly string DefaultDownloadDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            "Downloads"
        );

        private static readonly string[] VideoFields = new[]
        {
            "rawFileUrl",
            "contentUrl",
            "contentUrl1080p",
            "contentUrl720p",
            "contentUrl480p",
            "contentUrl360p",
            "socialMediaVideo"
        };

        private readonly WebView2 _webView;
        private readonly HttpClient _http;
        private readonly JavaScriptSerializer _json;
        private CancellationTokenSource _activeCts;
        private readonly object _ctsLock = new object();

        public MainForm()
        {
            Text = "MDLDownloader — Bulk Medal.tv Clip Downloader";
            Width = 1080;
            Height = 780;
            MinimumSize = new Size(760, 560);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(18, 19, 22);

            try
            {
                byte[] icoBytes = Program.ReadEmbeddedResource("app.ico");
                if (icoBytes != null && icoBytes.Length > 0)
                {
                    using (MemoryStream ms = new MemoryStream(icoBytes))
                    {
                        Icon = new Icon(ms);
                    }
                }
            }
            catch { }

            HttpClientHandler handler = new HttpClientHandler();
            handler.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            _http = new HttpClient(handler);
            _http.Timeout = TimeSpan.FromMinutes(10);
            _http.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

            _json = new JavaScriptSerializer();
            _json.MaxJsonLength = int.MaxValue;

            _webView = new WebView2();
            _webView.Dock = DockStyle.Fill;
            _webView.DefaultBackgroundColor = Color.FromArgb(18, 19, 22);
            Controls.Add(_webView);

            Load += OnFormLoad;
            FormClosing += OnFormClosing;
        }

        private async void OnFormLoad(object sender, EventArgs e)
        {
            try
            {
                string cacheDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "MDLDownloader",
                    "WebView2Cache"
                );
                Directory.CreateDirectory(cacheDir);
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, cacheDir);
                await _webView.EnsureCoreWebView2Async(env);

                _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
                _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
                _webView.CoreWebView2.Settings.AreDevToolsEnabled = true;
                _webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;

                string html = Program.ReadEmbeddedText("ui.html");
                _webView.CoreWebView2.NavigateToString(html);
            }
            catch (Exception ex)
            {
                DialogResult dr = MessageBox.Show(
                    "Could not initialize Microsoft Edge WebView2:\n" + ex.Message + "\n\nWould you like to open the Microsoft Edge WebView2 Runtime download page?",
                    "MDLDownloader Error",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Error
                );
                if (dr == DialogResult.Yes)
                {
                    try { Process.Start("https://developer.microsoft.com/en-us/microsoft-edge/webview2/"); } catch { }
                }
                Close();
            }
        }

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            CancelCurrentOperation();
            try { _http.Dispose(); } catch { }
        }

        private CancellationToken ResetCancellation()
        {
            lock (_ctsLock)
            {
                if (_activeCts != null)
                {
                    try { _activeCts.Cancel(); _activeCts.Dispose(); } catch { }
                }
                _activeCts = new CancellationTokenSource();
                return _activeCts.Token;
            }
        }

        private void CancelCurrentOperation()
        {
            lock (_ctsLock)
            {
                if (_activeCts != null)
                {
                    try { _activeCts.Cancel(); } catch { }
                }
            }
        }

        private void Emit(Dictionary<string, object> payload)
        {
            string jsonStr = _json.Serialize(payload);
            RunOnUi(delegate
            {
                if (_webView != null && _webView.CoreWebView2 != null && !IsDisposed)
                {
                    _webView.CoreWebView2.ExecuteScriptAsync("window.onDesktopEvent(" + jsonStr + ")");
                }
            });
        }

        private void ResolveRpc(string id, object result)
        {
            string jsonResult = _json.Serialize(result);
            RunOnUi(delegate
            {
                if (_webView != null && _webView.CoreWebView2 != null && !IsDisposed)
                {
                    _webView.CoreWebView2.ExecuteScriptAsync("window.__resolveDesktopRpc(" + _json.Serialize(id) + ", " + jsonResult + ")");
                }
            });
        }

        private void RunOnUi(Action action)
        {
            if (IsDisposed) return;
            if (InvokeRequired)
            {
                try { BeginInvoke(action); } catch { }
            }
            else
            {
                action();
            }
        }

        private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                string raw = e.TryGetWebMessageAsString();
                if (string.IsNullOrEmpty(raw)) return;

                Dictionary<string, object> msg = _json.Deserialize<Dictionary<string, object>>(raw);
                if (msg == null) return;

                string id = GetStr(msg, "id", "");
                string method = GetStr(msg, "method", "");
                object[] args = ToObjArray(msg.ContainsKey("args") ? msg["args"] : null);

                if (method == "get_init_info")
                {
                    Dictionary<string, object> res = new Dictionary<string, object>();
                    res["defaultDir"] = DefaultDownloadDir;
                    ResolveRpc(id, res);
                }
                else if (method == "open_external")
                {
                    string url = args.Length > 0 ? Convert.ToString(args[0]) : "";
                    if (!string.IsNullOrEmpty(url) && url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                    {
                        try
                        {
                            ProcessStartInfo psi = new ProcessStartInfo(url);
                            psi.UseShellExecute = true;
                            Process.Start(psi);
                        }
                        catch { }
                    }
                    ResolveRpc(id, true);
                }
                else if (method == "open_folder")
                {
                    string target = args.Length > 0 ? Convert.ToString(args[0]).Trim() : "";
                    if (string.IsNullOrEmpty(target)) target = DefaultDownloadDir;
                    try
                    {
                        Directory.CreateDirectory(target);
                        Process.Start("explorer.exe", target);
                    }
                    catch { }
                    ResolveRpc(id, true);
                }
                else if (method == "choose_folder")
                {
                    string cur = args.Length > 0 ? Convert.ToString(args[0]).Trim() : "";
                    if (string.IsNullOrEmpty(cur) || !Directory.Exists(cur)) cur = DefaultDownloadDir;
                    string chosen = "";
                    using (FolderBrowserDialog fbd = new FolderBrowserDialog())
                    {
                        fbd.Description = "Select output folder for MyClips";
                        fbd.SelectedPath = cur;
                        fbd.ShowNewFolderButton = true;
                        if (fbd.ShowDialog(this) == DialogResult.OK)
                        {
                            chosen = fbd.SelectedPath;
                        }
                    }
                    ResolveRpc(id, chosen);
                }
                else if (method == "cancel_operation")
                {
                    CancelCurrentOperation();
                    ResolveRpc(id, true);
                }
                else if (method == "start_fetch")
                {
                    string query = args.Length > 0 ? Convert.ToString(args[0]) : "";
                    string rawAuth = args.Length > 1 ? Convert.ToString(args[1]) : "";
                    CancellationToken ct = ResetCancellation();
                    Task.Run(delegate { return FetchWorkerAsync(query, rawAuth, ct); });
                    ResolveRpc(id, true);
                }
                else if (method == "start_download")
                {
                    object[] clipsRaw = args.Length > 0 ? ToObjArray(args[0]) : new object[0];
                    Dictionary<string, object> opts = args.Length > 1 ? args[1] as Dictionary<string, object> : new Dictionary<string, object>();
                    if (opts == null) opts = new Dictionary<string, object>();
                    CancellationToken ct = ResetCancellation();
                    Task.Run(delegate { return DownloadWorkerAsync(clipsRaw, opts, ct); });
                    ResolveRpc(id, true);
                }
            }
            catch { }
        }

        private async Task<string> HttpRequestTextAsync(HttpMethod method, string url, Dictionary<string, string> headers, string jsonBody, CancellationToken ct)
        {
            using (HttpRequestMessage req = new HttpRequestMessage(method, url))
            {
                req.Headers.TryAddWithoutValidation("Medal-User-Agent", "Medal-Nextjs/1.0 (simplified_signup)");
                req.Headers.TryAddWithoutValidation("Accept", "application/json");
                if (headers != null)
                {
                    foreach (KeyValuePair<string, string> kv in headers)
                    {
                        req.Headers.TryAddWithoutValidation(kv.Key, kv.Value);
                    }
                }
                if (jsonBody != null)
                {
                    req.Content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
                }
                using (HttpResponseMessage resp = await _http.SendAsync(req, ct))
                {
                    resp.EnsureSuccessStatusCode();
                    return await resp.Content.ReadAsStringAsync();
                }
            }
        }

        private async Task<string> CreateGuestAuthAsync(CancellationToken ct)
        {
            Dictionary<string, object> body = new Dictionary<string, object>();
            body["userName"] = "guest";
            body["email"] = "guest";
            body["password"] = Guid.NewGuid().ToString();

            string text = await HttpRequestTextAsync(HttpMethod.Post, "https://medal.tv/api/users", null, _json.Serialize(body), ct);
            Dictionary<string, object> data = _json.Deserialize<Dictionary<string, object>>(text);
            Dictionary<string, object> auth = data != null && data.ContainsKey("auth") ? data["auth"] as Dictionary<string, object> : null;
            Dictionary<string, object> user = data != null && data.ContainsKey("user") ? data["user"] as Dictionary<string, object> : null;

            string uid = GetStr(auth, "userId", "");
            if (string.IsNullOrEmpty(uid)) uid = GetStr(user, "userId", "");
            string key = GetStr(auth, "key", "");
            if (string.IsNullOrEmpty(uid) || string.IsNullOrEmpty(key))
            {
                throw new Exception("Could not initialize Medal.tv guest session.");
            }
            return uid + "," + key;
        }

        private async Task<Dictionary<string, object>> ResolveProfileAsync(string profileInput, string guestAuth, CancellationToken ct)
        {
            string clean = (profileInput ?? "").Trim();
            Match m = Regex.Match(clean, @"medal\.tv/(?:[a-zA-Z-]+/)?u/([^/?#]+)", RegexOptions.IgnoreCase);
            if (m.Success)
            {
                clean = Uri.UnescapeDataString(m.Groups[1].Value);
            }

            Dictionary<string, string> headers = new Dictionary<string, string>();
            headers["X-Authentication"] = guestAuth;

            if (Regex.IsMatch(clean, @"^\d+$"))
            {
                try
                {
                    string txt = await HttpRequestTextAsync(HttpMethod.Get, "https://medal.tv/api/users/" + Uri.EscapeDataString(clean), headers, null, ct);
                    Dictionary<string, object> u = _json.Deserialize<Dictionary<string, object>>(txt);
                    if (u != null && !string.IsNullOrEmpty(GetStr(u, "userId", "")))
                    {
                        Dictionary<string, object> p = new Dictionary<string, object>();
                        p["userId"] = GetStr(u, "userId", clean);
                        p["userName"] = GetStr(u, "userName", clean);
                        p["displayName"] = GetStr(u, "displayName", GetStr(u, "userName", clean));
                        p["thumbnail"] = u.ContainsKey("thumbnail") ? u["thumbnail"] : null;
                        p["submissions"] = GetInt(u, "submissions", 0);
                        return p;
                    }
                }
                catch { }
                Dictionary<string, object> fb = new Dictionary<string, object>();
                fb["userId"] = clean;
                fb["userName"] = clean;
                fb["displayName"] = clean;
                fb["thumbnail"] = null;
                fb["submissions"] = 0;
                return fb;
            }

            try
            {
                string txt = await HttpRequestTextAsync(HttpMethod.Get, "https://medal.tv/api/users?username=" + Uri.EscapeDataString(clean), headers, null, ct);
                object[] arr = _json.Deserialize<object[]>(txt);
                if (arr != null && arr.Length > 0)
                {
                    Dictionary<string, object> u = arr[0] as Dictionary<string, object>;
                    if (u != null && !string.IsNullOrEmpty(GetStr(u, "userId", "")))
                    {
                        Dictionary<string, object> p = new Dictionary<string, object>();
                        p["userId"] = GetStr(u, "userId", "");
                        p["userName"] = GetStr(u, "userName", clean);
                        p["displayName"] = GetStr(u, "displayName", GetStr(u, "userName", clean));
                        p["thumbnail"] = u.ContainsKey("thumbnail") ? u["thumbnail"] : null;
                        p["submissions"] = GetInt(u, "submissions", 0);
                        return p;
                    }
                }
            }
            catch { }

            using (HttpRequestMessage req = new HttpRequestMessage(HttpMethod.Get, "https://medal.tv/u/" + Uri.EscapeDataString(clean)))
            {
                req.Headers.TryAddWithoutValidation("Accept", "text/html");
                using (HttpResponseMessage resp = await _http.SendAsync(req, ct))
                {
                    string html = await resp.Content.ReadAsStringAsync();
                    Match uidM = Regex.Match(html, @"\\""userId\\"":\\""?(\d+)\\""?");
                    if (!uidM.Success) uidM = Regex.Match(html, @"""userId"":""?(\d+)""?");
                    if (uidM.Success)
                    {
                        Match subM = Regex.Match(html, @"\\""submissions\\"":(\d+)");
                        Match thumbM = Regex.Match(html, @"\\""thumbnail\\"":\\""(https://cdn\.medal\.tv/avatars/[^\\""]+)\\""");
                        Dictionary<string, object> p = new Dictionary<string, object>();
                        p["userId"] = uidM.Groups[1].Value;
                        p["userName"] = clean;
                        p["displayName"] = clean;
                        p["thumbnail"] = thumbM.Success ? thumbM.Groups[1].Value : null;
                        p["submissions"] = subM.Success ? int.Parse(subM.Groups[1].Value) : 0;
                        return p;
                    }
                }
            }

            throw new Exception("Could not find profile for '" + clean + "'.");
        }

        private string ParseCustomAuth(string rawInput, string fallbackUid)
        {
            string val = (rawInput ?? "").Trim().Trim('"', '\'');
            if (string.IsNullOrEmpty(val)) return "";
            try
            {
                string candidate = val.Contains("%") ? Uri.UnescapeDataString(val) : val;
                if (candidate.StartsWith("{"))
                {
                    Dictionary<string, object> obj = _json.Deserialize<Dictionary<string, object>>(candidate);
                    string k = GetStr(obj, "key", "");
                    if (!string.IsNullOrEmpty(k))
                    {
                        string u = GetStr(obj, "userId", fallbackUid);
                        return (string.IsNullOrEmpty(u) ? fallbackUid : u) + "," + k;
                    }
                }
                string b64 = candidate.Replace('-', '+').Replace('_', '/');
                int mod = b64.Length % 4;
                if (mod != 0) b64 += new string('=', 4 - mod);
                string decoded = Encoding.UTF8.GetString(Convert.FromBase64String(b64)).Trim();
                if (decoded.StartsWith("{"))
                {
                    Dictionary<string, object> obj = _json.Deserialize<Dictionary<string, object>>(decoded);
                    string k = GetStr(obj, "key", "");
                    if (!string.IsNullOrEmpty(k))
                    {
                        string u = GetStr(obj, "userId", fallbackUid);
                        return (string.IsNullOrEmpty(u) ? fallbackUid : u) + "," + k;
                    }
                }
            }
            catch { }

            if (val.Contains(",")) return val;
            return fallbackUid + "," + val;
        }

        private static void ExtractBestUrl(Dictionary<string, object> clip, out string bestUrl, out bool isProtected)
        {
            bestUrl = null;
            isProtected = false;
            for (int i = 0; i < VideoFields.Length; i++)
            {
                string val = GetStr(clip, VideoFields[i], "");
                if (!string.IsNullOrEmpty(val))
                {
                    if (val.IndexOf("privacy-protected-guest", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        isProtected = true;
                    }
                    else if (!val.EndsWith("&missing", StringComparison.Ordinal))
                    {
                        bestUrl = val;
                        isProtected = false;
                        return;
                    }
                }
            }
        }

        private async Task FetchWorkerAsync(string query, string rawAuth, CancellationToken ct)
        {
            try
            {
                string guestAuth = await CreateGuestAuthAsync(ct);
                Dictionary<string, object> profile = await ResolveProfileAsync(query, guestAuth, ct);
                string userId = GetStr(profile, "userId", "");
                int subs = GetInt(profile, "submissions", 0);

                string customAuth = ParseCustomAuth(rawAuth, userId);
                string authHeader = !string.IsNullOrEmpty(customAuth) ? customAuth : guestAuth;
                string[] privModes = !string.IsNullOrEmpty(customAuth) ? new[] { "", "&privacy=0" } : new[] { "&privacy=0" };

                Dictionary<string, string> headers = new Dictionary<string, string>();
                headers["X-Authentication"] = authHeader;

                List<Dictionary<string, object>> allClips = new List<Dictionary<string, object>>();
                HashSet<string> seen = new HashSet<string>();

                for (int m = 0; m < privModes.Length; m++)
                {
                    int offset = 0;
                    while (!ct.IsCancellationRequested)
                    {
                        string url = string.Format(
                            "https://medal.tv/api/content?userId={0}{1}&limit=50&offset={2}&sortDirection=DESC",
                            Uri.EscapeDataString(userId), privModes[m], offset
                        );
                        string txt = await HttpRequestTextAsync(HttpMethod.Get, url, headers, null, ct);
                        object[] batch = _json.Deserialize<object[]>(txt);
                        if (batch == null || batch.Length == 0) break;

                        for (int i = 0; i < batch.Length; i++)
                        {
                            Dictionary<string, object> c = batch[i] as Dictionary<string, object>;
                            if (c == null) continue;
                            string cid = GetStr(c, "contentId", "");
                            if (string.IsNullOrEmpty(cid) || seen.Contains(cid)) continue;
                            seen.Add(cid);

                            string bestUrl;
                            bool isProt;
                            ExtractBestUrl(c, out bestUrl, out isProt);

                            Dictionary<string, object> cat = c.ContainsKey("category") ? c["category"] as Dictionary<string, object> : null;
                            string thumb = GetStr(c, "thumbnail720p", "");
                            if (string.IsNullOrEmpty(thumb)) thumb = GetStr(c, "thumbnail480p", "");
                            if (string.IsNullOrEmpty(thumb)) thumb = GetStr(c, "thumbnail360p", "");
                            if (string.IsNullOrEmpty(thumb)) thumb = GetStr(c, "thumbnailUrl", "");

                            Dictionary<string, object> item = new Dictionary<string, object>();
                            item["index"] = allClips.Count + 1;
                            item["contentId"] = cid;
                            item["title"] = GetStr(c, "contentTitle", "Untitled");
                            item["category"] = "";
                            item["game"] = GetStr(cat, "categoryName", "General");
                            item["duration"] = GetDouble(c, "videoLengthSeconds", 0);
                            item["height"] = GetInt(c, "sourceHeight", 1080);
                            item["created"] = GetLong(c, "created", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                            item["views"] = GetLong(c, "views", 0);
                            item["thumbnail"] = thumb;
                            item["videoUrl"] = bestUrl;
                            item["isProtected"] = isProt;
                            allClips.Add(item);
                        }

                        string hint = (subs > 0 && subs >= allClips.Count) ? (" / ~" + subs) : "";
                        Dictionary<string, object> prog = new Dictionary<string, object>();
                        prog["type"] = "fetch_progress";
                        prog["message"] = "Loaded " + allClips.Count + hint + " clips...";
                        Emit(prog);

                        if (batch.Length < 50) break;
                        offset += 50;
                    }
                }

                Dictionary<string, object> done = new Dictionary<string, object>();
                done["type"] = "fetch_done";
                done["profile"] = profile;
                done["clips"] = allClips;
                Emit(done);
            }
            catch (OperationCanceledException)
            {
                Dictionary<string, object> done = new Dictionary<string, object>();
                done["type"] = "fetch_done";
                done["error"] = "Cancelled.";
                Emit(done);
            }
            catch (Exception ex)
            {
                Dictionary<string, object> done = new Dictionary<string, object>();
                done["type"] = "fetch_done";
                done["error"] = ex.Message;
                Emit(done);
            }
        }

        private async Task DownloadWorkerAsync(object[] clipsRaw, Dictionary<string, object> options, CancellationToken ct)
        {
            string stagingDir = null;
            try
            {
                string baseOutDir = GetStr(options, "outDir", "").Trim();
                if (string.IsNullOrEmpty(baseOutDir)) baseOutDir = DefaultDownloadDir;
                Directory.CreateDirectory(baseOutDir);

                bool zipMode = !options.ContainsKey("zipMode") || Convert.ToBoolean(options["zipMode"]);
                bool groupByGame = !options.ContainsKey("groupByGame") || Convert.ToBoolean(options["groupByGame"]);
                bool isRetry = options.ContainsKey("isRetry") && Convert.ToBoolean(options["isRetry"]);
                string cleanUser = SanitizeFilename(GetStr(options, "username", "Archive"));

                string workDir;
                if (zipMode)
                {
                    stagingDir = Path.Combine(Path.GetTempPath(), "mdldownloader_" + Guid.NewGuid().ToString("N").Substring(0, 8));
                    Directory.CreateDirectory(stagingDir);
                    workDir = stagingDir;
                }
                else
                {
                    workDir = Path.Combine(baseOutDir, "MyClips_" + cleanUser);
                    Directory.CreateDirectory(workDir);
                }

                List<Dictionary<string, object>> clips = new List<Dictionary<string, object>>();
                for (int i = 0; i < clipsRaw.Length; i++)
                {
                    Dictionary<string, object> d = clipsRaw[i] as Dictionary<string, object>;
                    if (d != null) clips.Add(d);
                }

                int total = clips.Count;
                int completed = 0;
                long totalBytes = 0;
                ConcurrentBag<string> downloadedFiles = new ConcurrentBag<string>();
                ConcurrentBag<Dictionary<string, object>> failed = new ConcurrentBag<Dictionary<string, object>>();
                object emitLock = new object();

                using (SemaphoreSlim sem = new SemaphoreSlim(8, 8))
                {
                    List<Task> tasks = new List<Task>();
                    for (int i = 0; i < clips.Count; i++)
                    {
                        Dictionary<string, object> clip = clips[i];
                        tasks.Add(Task.Run(async delegate
                        {
                            await sem.WaitAsync(ct);
                            string logLine = null;
                            try
                            {
                                if (ct.IsCancellationRequested) return;
                                string cid = GetStr(clip, "contentId", "0");
                                string title = SanitizeFilename(GetStr(clip, "title", "Untitled"));
                                string game = SanitizeFilename(GetStr(clip, "game", "General"));
                                int idx = GetInt(clip, "index", 1);
                                string videoUrl = GetStr(clip, "videoUrl", "");

                                string targetFolder = groupByGame ? Path.Combine(workDir, game) : workDir;
                                Directory.CreateDirectory(targetFolder);
                                string fname = string.Format("{0:D4}_{1}_{2}.mp4", idx, title, cid);
                                string fpath = Path.Combine(targetFolder, fname);

                                if (File.Exists(fpath) && new FileInfo(fpath).Length > 1000)
                                {
                                    long exSize = new FileInfo(fpath).Length;
                                    downloadedFiles.Add(fpath);
                                    Interlocked.Add(ref totalBytes, exSize);
                                    logLine = "SKIPPED (exists): " + fname;
                                }
                                else
                                {
                                    bool ok = false;
                                    string lastErr = null;
                                    for (int attempt = 0; attempt < 2 && !ct.IsCancellationRequested; attempt++)
                                    {
                                        string partPath = fpath + ".part";
                                        bool retryDelay = false;
                                        try
                                        {
                                            using (HttpResponseMessage resp = await _http.GetAsync(videoUrl, HttpCompletionOption.ResponseHeadersRead, ct))
                                            {
                                                resp.EnsureSuccessStatusCode();
                                                using (Stream src = await resp.Content.ReadAsStreamAsync())
                                                using (FileStream dst = new FileStream(partPath, FileMode.Create, FileAccess.Write, FileShare.None, 524288, true))
                                                {
                                                    byte[] buf = new byte[524288];
                                                    int n;
                                                    while ((n = await src.ReadAsync(buf, 0, buf.Length, ct)) > 0)
                                                    {
                                                        await dst.WriteAsync(buf, 0, n, ct);
                                                    }
                                                }
                                            }
                                            if (!ct.IsCancellationRequested && File.Exists(partPath) && new FileInfo(partPath).Length > 1000)
                                            {
                                                if (File.Exists(fpath)) File.Delete(fpath);
                                                File.Move(partPath, fpath);
                                                long fsize = new FileInfo(fpath).Length;
                                                downloadedFiles.Add(fpath);
                                                Interlocked.Add(ref totalBytes, fsize);
                                                logLine = "DOWNLOADED (" + FormatBytes(fsize) + "): " + fname;
                                                ok = true;
                                                break;
                                            }
                                        }
                                        catch (Exception ex)
                                        {
                                            lastErr = ex.Message;
                                            try { if (File.Exists(partPath)) File.Delete(partPath); } catch { }
                                            if (attempt == 0 && !ct.IsCancellationRequested)
                                            {
                                                retryDelay = true;
                                            }
                                        }
                                        if (retryDelay)
                                        {
                                            await Task.Delay(500, ct);
                                        }
                                    }

                                    if (!ok && !ct.IsCancellationRequested)
                                    {
                                        failed.Add(clip);
                                        logLine = "FAILED: " + fname + " (" + (lastErr ?? "Stream error") + ")";
                                    }
                                }
                            }
                            finally
                            {
                                sem.Release();
                                if (!ct.IsCancellationRequested)
                                {
                                    int curDone = Interlocked.Increment(ref completed);
                                    long curBytes = Interlocked.Read(ref totalBytes);
                                    int pct = total > 0 ? (int)Math.Round((double)curDone * 100.0 / total) : 100;
                                    Dictionary<string, object> p = new Dictionary<string, object>();
                                    p["type"] = "dl_progress";
                                    p["done"] = curDone;
                                    p["total"] = total;
                                    p["percent"] = pct;
                                    p["bytes"] = curBytes;
                                    p["message"] = string.Format("Downloading ({0}/{1})...", curDone, total);
                                    p["log"] = logLine;
                                    lock (emitLock) { Emit(p); }
                                }
                            }
                        }, ct));
                    }

                    await Task.WhenAll(tasks);
                }

                if (ct.IsCancellationRequested)
                {
                    Dictionary<string, object> cancelled = new Dictionary<string, object>();
                    cancelled["type"] = "dl_done";
                    cancelled["cancelled"] = true;
                    Emit(cancelled);
                    return;
                }

                List<string> fileList = new List<string>(downloadedFiles);
                fileList.Sort(StringComparer.Ordinal);
                List<Dictionary<string, object>> failedList = new List<Dictionary<string, object>>(failed);

                string summary;
                if (fileList.Count > 0)
                {
                    if (zipMode)
                    {
                        string zipFilename = "MyClips_" + cleanUser + ".zip";
                        string zipPath = Path.Combine(baseOutDir, zipFilename);
                        if (isRetry && File.Exists(zipPath))
                        {
                            long ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                            zipPath = Path.Combine(baseOutDir, "MyClips_" + cleanUser + "_retry_" + ts + ".zip");
                        }
                        else if (File.Exists(zipPath))
                        {
                            File.Delete(zipPath);
                        }

                        Dictionary<string, object> pkgProg = new Dictionary<string, object>();
                        pkgProg["type"] = "dl_progress";
                        pkgProg["done"] = total;
                        pkgProg["total"] = total;
                        pkgProg["percent"] = 99;
                        pkgProg["bytes"] = totalBytes;
                        pkgProg["message"] = "Packaging " + zipFilename + "...";
                        Emit(pkgProg);

                        using (ZipArchive archive = ZipFile.Open(zipPath, ZipArchiveMode.Create))
                        {
                            foreach (string fp in fileList)
                            {
                                if (File.Exists(fp))
                                {
                                    string rel = GetRelativePath(workDir, fp).Replace('\\', '/');
                                    archive.CreateEntryFromFile(fp, "MyClips/" + rel, CompressionLevel.NoCompression);
                                }
                            }
                            if (failedList.Count > 0)
                            {
                                ZipArchiveEntry noteEntry = archive.CreateEntry("MyClips/_FAILED_CLIPS.txt", CompressionLevel.Optimal);
                                using (StreamWriter sw = new StreamWriter(noteEntry.Open(), Encoding.UTF8))
                                {
                                    sw.WriteLine("Failed clips:");
                                    sw.WriteLine();
                                    foreach (Dictionary<string, object> fc in failedList)
                                    {
                                        sw.WriteLine(string.Format("{0:D4}_{1}_{2}.mp4", GetInt(fc, "index", 0), GetStr(fc, "title", "Untitled"), GetStr(fc, "contentId", "")));
                                    }
                                }
                            }
                        }

                        summary = string.Format("Completed! Saved {0} clips ({1}) to {2}", fileList.Count, FormatBytes(totalBytes), zipPath);
                    }
                    else
                    {
                        summary = string.Format("Completed! Saved {0} clips ({1}) to {2}", fileList.Count, FormatBytes(totalBytes), workDir);
                    }
                }
                else
                {
                    summary = "No clips could be downloaded.";
                }

                Dictionary<string, object> done = new Dictionary<string, object>();
                done["type"] = "dl_done";
                done["summary"] = summary;
                done["failedClips"] = failedList;
                done["log"] = summary;
                Emit(done);
            }
            catch (OperationCanceledException)
            {
                Dictionary<string, object> cancelled = new Dictionary<string, object>();
                cancelled["type"] = "dl_done";
                cancelled["cancelled"] = true;
                Emit(cancelled);
            }
            catch (Exception ex)
            {
                Dictionary<string, object> err = new Dictionary<string, object>();
                err["type"] = "dl_done";
                err["error"] = ex.Message;
                Emit(err);
            }
            finally
            {
                if (!string.IsNullOrEmpty(stagingDir) && Directory.Exists(stagingDir))
                {
                    try { Directory.Delete(stagingDir, true); } catch { }
                }
            }
        }

        private static string GetRelativePath(string rootDir, string fullPath)
        {
            string normRoot = Path.GetFullPath(rootDir).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            string normFull = Path.GetFullPath(fullPath);
            if (normFull.StartsWith(normRoot, StringComparison.OrdinalIgnoreCase))
            {
                return normFull.Substring(normRoot.Length);
            }
            return Path.GetFileName(normFull);
        }

        private static string SanitizeFilename(string name)
        {
            string s = Regex.Replace(name ?? "Untitled", @"[\\/*?:""<>|]", "_").Trim();
            if (s.Length > 75) s = s.Substring(0, 75);
            return string.IsNullOrEmpty(s) ? "Untitled" : s;
        }

        private static string FormatBytes(long bytes)
        {
            if (bytes <= 0) return "0 MB";
            if (bytes >= 1024L * 1024L * 1024L)
            {
                return string.Format("{0:0.00} GB", (double)bytes / (1024.0 * 1024.0 * 1024.0));
            }
            return Math.Round((double)bytes / (1024.0 * 1024.0)) + " MB";
        }

        private static object[] ToObjArray(object val)
        {
            if (val == null) return new object[0];
            object[] arr = val as object[];
            if (arr != null) return arr;
            System.Collections.ArrayList list = val as System.Collections.ArrayList;
            if (list != null) return list.ToArray();
            return new object[0];
        }

        private static string GetStr(Dictionary<string, object> d, string key, string fallback)
        {
            if (d == null || !d.ContainsKey(key) || d[key] == null) return fallback;
            return Convert.ToString(d[key]);
        }

        private static int GetInt(Dictionary<string, object> d, string key, int fallback)
        {
            if (d == null || !d.ContainsKey(key) || d[key] == null) return fallback;
            try { return Convert.ToInt32(d[key]); } catch { return fallback; }
        }

        private static long GetLong(Dictionary<string, object> d, string key, long fallback)
        {
            if (d == null || !d.ContainsKey(key) || d[key] == null) return fallback;
            try { return Convert.ToInt64(d[key]); } catch { return fallback; }
        }

        private static double GetDouble(Dictionary<string, object> d, string key, double fallback)
        {
            if (d == null || !d.ContainsKey(key) || d[key] == null) return fallback;
            try { return Convert.ToDouble(d[key]); } catch { return fallback; }
        }
    }
}
