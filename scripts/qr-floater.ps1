# Always-on-top, borderless, click-through QR sticker window.
#
# Args:
#   -ImagePath    full path to the primary PNG (e.g. KTV URL QR)
#   -ImagePath2   optional second PNG (e.g. WiFi QR). When supplied,
#                 the window doubles in width and shows two QRs side
#                 by side: ImagePath2 on the LEFT (① 连 WiFi),
#                 ImagePath on the RIGHT (② 点歌).
#   -Corner       top-right | top-left | bottom-right | bottom-left
#   -Size         pixel side of each QR
#   -Margin       pixel offset from the corner
#
# The window survives mpv going fullscreen, the user switching apps,
# the desktop being shown — anything short of taskmgr killing the
# process. It's a real top-level HWND with WS_EX_TOPMOST | WS_EX_LAYERED
# | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW, so mouse events fall through
# and the taskbar doesn't show an entry.
#
# Images are reloaded whenever their mtime changes, so the backend can
# rewrite qr.png / qr-wifi.png and the sticker picks it up live.

param(
    [Parameter(Mandatory=$true)][string]$ImagePath,
    [string]$ImagePath2 = '',
    [string]$Corner = 'top-right',
    [int]$Size = 220,
    [int]$Margin = 24,
    # Single-image mode only: text shown above the QR.
    [string]$Label = '扫码点歌',
    # Single-image mode only: HEX of the label background, e.g. "#be185d".
    [string]$LabelColor = '#be185d'
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Native {
    public const int GWL_EXSTYLE   = -20;
    public const int WS_EX_LAYERED = 0x80000;
    public const int WS_EX_TRANSPARENT = 0x20;
    public const int WS_EX_TOOLWINDOW = 0x80;
    public const int WS_EX_TOPMOST = 0x8;
    public const int WS_EX_NOACTIVATE = 0x08000000;

    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int idx);
    [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int idx, int v);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(
        IntPtr hWnd, IntPtr hAfter, int X, int Y, int cx, int cy, uint flags);

    public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    public const uint SWP_NOMOVE = 0x0002;
    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint SWP_SHOWWINDOW = 0x0040;
}
"@

if (-not (Test-Path $ImagePath)) {
    Write-Host "[qr-floater] image not found: $ImagePath"
    exit 2
}

$hasSecond = ($ImagePath2 -and (Test-Path $ImagePath2))
$labelHeight = 22
$gap = 14
$cellHeight = $Size + $labelHeight
$winWidth = if ($hasSecond) { ($Size * 2) + $gap } else { $Size }
$winHeight = $cellHeight

$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.StartPosition = 'Manual'
$form.Size = New-Object System.Drawing.Size($winWidth, $winHeight)
$form.BackColor = [System.Drawing.Color]::Magenta
$form.TransparencyKey = [System.Drawing.Color]::Magenta

# Compute corner position on the primary working area.
$work = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
switch ($Corner) {
    'top-left'     { $x = $work.Left + $Margin;                $y = $work.Top + $Margin }
    'top-right'    { $x = $work.Right - $winWidth - $Margin;   $y = $work.Top + $Margin }
    'bottom-left'  { $x = $work.Left + $Margin;                $y = $work.Bottom - $winHeight - $Margin }
    'bottom-right' { $x = $work.Right - $winWidth - $Margin;   $y = $work.Bottom - $winHeight - $Margin }
    default        { $x = $work.Right - $winWidth - $Margin;   $y = $work.Top + $Margin }
}
$form.Location = New-Object System.Drawing.Point($x, $y)

$labelFont = New-Object System.Drawing.Font('Microsoft YaHei UI', 10, [System.Drawing.FontStyle]::Bold)

function New-QrCell {
    param([int]$X, [string]$LabelText, [System.Drawing.Color]$LabelBg)
    $panel = New-Object System.Windows.Forms.Panel
    $panel.Location = New-Object System.Drawing.Point($X, 0)
    $panel.Size = New-Object System.Drawing.Size($Size, $cellHeight)
    $panel.BackColor = [System.Drawing.Color]::Magenta

    $label = New-Object System.Windows.Forms.Label
    $label.Text = $LabelText
    $label.Font = $labelFont
    $label.ForeColor = [System.Drawing.Color]::White
    $label.BackColor = $LabelBg
    $label.TextAlign = 'MiddleCenter'
    $label.Size = New-Object System.Drawing.Size($Size, $labelHeight)
    $label.Location = New-Object System.Drawing.Point(0, 0)
    $panel.Controls.Add($label)

    $pic = New-Object System.Windows.Forms.PictureBox
    $pic.Size = New-Object System.Drawing.Size($Size, $Size)
    $pic.Location = New-Object System.Drawing.Point(0, $labelHeight)
    $pic.SizeMode = 'Zoom'
    $pic.BackColor = [System.Drawing.Color]::White
    $panel.Controls.Add($pic)

    return @{ panel = $panel; pic = $pic }
}

if ($hasSecond) {
    # Step 1: WiFi (cyan label) on the left
    $cell1 = New-QrCell -X 0 -LabelText '① 连 WiFi' -LabelBg ([System.Drawing.Color]::FromArgb(255, 14, 116, 144))
    $form.Controls.Add($cell1.panel)
    # Step 2: URL (pink label) on the right
    $cell2 = New-QrCell -X ($Size + $gap) -LabelText '② 扫码点歌' -LabelBg ([System.Drawing.Color]::FromArgb(255, 190, 24, 93))
    $form.Controls.Add($cell2.panel)
    $picWifi = $cell1.pic
    $picUrl = $cell2.pic
} else {
    # Parse #rrggbb hex into a Color, with a sane fallback to pink if the
    # caller passed garbage.
    function Parse-HexColor {
        param([string]$Hex)
        try {
            $h = $Hex.TrimStart('#')
            $r = [Convert]::ToInt32($h.Substring(0,2), 16)
            $g = [Convert]::ToInt32($h.Substring(2,2), 16)
            $b = [Convert]::ToInt32($h.Substring(4,2), 16)
            return [System.Drawing.Color]::FromArgb(255, $r, $g, $b)
        } catch {
            return [System.Drawing.Color]::FromArgb(255, 190, 24, 93)
        }
    }
    $bg = Parse-HexColor -Hex $LabelColor
    $cell = New-QrCell -X 0 -LabelText $Label -LabelBg $bg
    $form.Controls.Add($cell.panel)
    $picUrl = $cell.pic
    $picWifi = $null
}

function Load-Image {
    param([System.Windows.Forms.PictureBox]$Pic, [string]$Path)
    try {
        $bytes = [System.IO.File]::ReadAllBytes($Path)
        $ms = New-Object System.IO.MemoryStream(,$bytes)
        $img = [System.Drawing.Image]::FromStream($ms)
        if ($Pic.Image) { $Pic.Image.Dispose() }
        $Pic.Image = $img
    } catch {
        Write-Host "[qr-floater] load failed: $_"
    }
}

Load-Image -Pic $picUrl -Path $ImagePath
$lastWriteUrl = (Get-Item $ImagePath).LastWriteTimeUtc
$lastWriteWifi = [datetime]::MinValue
if ($hasSecond) {
    Load-Image -Pic $picWifi -Path $ImagePath2
    $lastWriteWifi = (Get-Item $ImagePath2).LastWriteTimeUtc
}

$form.Add_HandleCreated({
    $h = $form.Handle
    $ex = [Native]::GetWindowLong($h, [Native]::GWL_EXSTYLE)
    $ex = $ex -bor [Native]::WS_EX_LAYERED `
              -bor [Native]::WS_EX_TRANSPARENT `
              -bor [Native]::WS_EX_TOOLWINDOW `
              -bor [Native]::WS_EX_TOPMOST `
              -bor [Native]::WS_EX_NOACTIVATE
    [void][Native]::SetWindowLong($h, [Native]::GWL_EXSTYLE, $ex)
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({
    if ($form.IsHandleCreated -and -not $form.IsDisposed) {
        [void][Native]::SetWindowPos(
            $form.Handle,
            [Native]::HWND_TOPMOST,
            0, 0, 0, 0,
            [Native]::SWP_NOMOVE -bor [Native]::SWP_NOSIZE -bor [Native]::SWP_NOACTIVATE)
        try {
            $curUrl = (Get-Item $ImagePath -ErrorAction Stop).LastWriteTimeUtc
            if ($curUrl -ne $lastWriteUrl) {
                $lastWriteUrl = $curUrl
                Load-Image -Pic $picUrl -Path $ImagePath
            }
        } catch { }
        if ($hasSecond) {
            try {
                $curWifi = (Get-Item $ImagePath2 -ErrorAction Stop).LastWriteTimeUtc
                if ($curWifi -ne $lastWriteWifi) {
                    $lastWriteWifi = $curWifi
                    Load-Image -Pic $picWifi -Path $ImagePath2
                }
            } catch { }
        }
    }
})
$timer.Start()

[System.Windows.Forms.Application]::Run($form)
