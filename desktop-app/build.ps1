$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
    throw "Microsoft C# Compiler (csc.exe) not found at $csc"
}

Get-Process -Name "MDLDownloader" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300

$outExe = Join-Path $dir "MDLDownloader.exe"
$libDir = Join-Path $dir "lib"

& $csc `
    /nologo `
    /target:winexe `
    /platform:x64 `
    /optimize+ `
    /win32icon:"$dir\app.ico" `
    /win32manifest:"$dir\app.manifest" `
    /out:"$outExe" `
    /reference:"$libDir\Microsoft.Web.WebView2.Core.dll" `
    /reference:"$libDir\Microsoft.Web.WebView2.WinForms.dll" `
    /reference:System.dll `
    /reference:System.Core.dll `
    /reference:System.Drawing.dll `
    /reference:System.Net.Http.dll `
    /reference:System.Web.Extensions.dll `
    /reference:System.Windows.Forms.dll `
    /reference:System.IO.Compression.dll `
    /reference:System.IO.Compression.FileSystem.dll `
    /resource:"$dir\ui.html,ui.html" `
    /resource:"$dir\app.ico,app.ico" `
    /resource:"$libDir\Microsoft.Web.WebView2.Core.dll,Microsoft.Web.WebView2.Core.dll" `
    /resource:"$libDir\Microsoft.Web.WebView2.WinForms.dll,Microsoft.Web.WebView2.WinForms.dll" `
    /resource:"$libDir\WebView2Loader.dll,WebView2Loader.dll" `
    "$dir\Program.cs"

if ($LASTEXITCODE -ne 0) {
    throw "csc.exe build failed with exit code $LASTEXITCODE"
}

$info = Get-Item $outExe
$hash = (Get-FileHash $outExe -Algorithm SHA256).Hash.ToLower()
$webDlExe = Join-Path (Split-Path -Parent $dir) "web\public\downloads\MDLDownloader.exe"
if (Test-Path (Split-Path -Parent $webDlExe)) {
    Copy-Item -Path $outExe -Destination $webDlExe -Force
}
Write-Output ("Built $outExe => " + $info.Length + " bytes, SHA-256=" + $hash)
