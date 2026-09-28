# Helper: report which node currently has input focus in a saved uiautomator dump.
# Usage: pwsh -File c:\mahaa\tools\focus.ps1 -In <path to _ui.xml>
#
# `ui.ps1 -Action dump` prints labels and bounds but not the focused flag, and
# deciding where `adb shell input text` will land by reading the screenshot is
# unreliable: the captured PNG is scaled to the image viewer's width, so a
# coordinate copied off it is off by the 1080/viewer-width ratio and silently
# taps a neighbouring key.
param(
  [Parameter(Mandatory = $true)][string]$In
)

if (-not (Test-Path $In)) { throw "focus.ps1: no dump at $In" }
$raw = Get-Content $In -Raw
$found = $false
foreach ($n in [regex]::Matches($raw, '<node[^>]*>')) {
  if ($n.Value -notmatch 'focused="true"') { continue }
  $found = $true
  $c = [regex]::Match($n.Value, 'class="([^"]*)"').Groups[1].Value
  $t = [regex]::Match($n.Value, 'text="([^"]*)"').Groups[1].Value
  $d = [regex]::Match($n.Value, 'content-desc="([^"]*)"').Groups[1].Value
  $b = [regex]::Match($n.Value, 'bounds="([^"]*)"').Groups[1].Value
  $p = [regex]::Match($n.Value, 'password="([^"]*)"').Groups[1].Value
  "FOCUSED {0} | text='{1}' desc='{2}' password={3} | {4}" -f $c.Split('.')[-1], $t, $d, $p, $b
}
if (-not $found) { 'FOCUSED none' }
