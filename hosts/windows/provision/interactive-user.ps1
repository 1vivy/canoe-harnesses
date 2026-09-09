# /IT tasks require the requested user to have a real logged-on desktop.
param([ValidateSet("canoe", "std")] [string] $User)
$ErrorActionPreference = "Stop"
$oldDebug = [Environment]::GetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', 'Machine')
if ($oldDebug) {
  # Migrate early fixtures: a global debug port also attaches Widgets/other
  # WebView2 processes, which can win the port before the app starts.
  [Environment]::SetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', $null, 'Machine')
}
$current = (Get-CimInstance Win32_ComputerSystem).UserName
if (-not $oldDebug -and $current -and $current.Split('\')[-1] -eq $User) { "ready"; exit 0 }
$key = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
Set-ItemProperty $key AutoAdminLogon '1'
Set-ItemProperty $key DefaultUserName $User
Set-ItemProperty $key DefaultDomainName $env:COMPUTERNAME
Set-ItemProperty $key DefaultPassword 'canoe-e2e'
shutdown.exe /r /t 3 /f | Out-Null
"rebooting"
