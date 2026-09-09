# Turns a fresh Windows 11 guest into a harness node. Idempotent.
$ErrorActionPreference = "Continue"
$root = "C:\canoe"
New-Item -ItemType Directory -Force -Path $root, "$root\logs" | Out-Null
Start-Transcript -Path "$root\logs\setup.log" -Append | Out-Null

function Step($name, [scriptblock]$body) {
  Write-Host "== $name"
  try { & $body } catch { Write-Host "!! $name failed: $_" }
}

Step "Keep the guest awake" {
  powercfg /change standby-timeout-ac 0
  powercfg /change monitor-timeout-ac 0
  powercfg /hibernate off
}

Step "Defender exclusions for the toolkit and the harness root" {
  Set-MpPreference -ExclusionPath $root -ErrorAction SilentlyContinue
  Set-MpPreference -DisableRealtimeMonitoring $true -ErrorAction SilentlyContinue
}

Step "OpenSSH server" {
  $cap = Get-WindowsCapability -Online -Name "OpenSSH.Server*"
  if ($cap.State -ne "Installed") {
    for ($i = 0; $i -lt 5; $i++) {
      Add-WindowsCapability -Online -Name $cap.Name
      if ((Get-WindowsCapability -Online -Name $cap.Name).State -eq "Installed") { break }
      Start-Sleep -Seconds 30
    }
  }
  Set-Service -Name sshd -StartupType Automatic
  Start-Service sshd
  if (-not (Get-NetFirewallRule -Name "canoe-ssh" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name "canoe-ssh" -DisplayName "canoe e2e ssh" -Direction Inbound -Protocol TCP -LocalPort 22 -Action Allow | Out-Null
  }
  New-Item -Path "HKLM:\SOFTWARE\OpenSSH" -Force | Out-Null
  Set-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell -Value "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
  $keys = Join-Path $PSScriptRoot "authorized_keys"
  if (Test-Path $keys) {
    $dest = "C:\ProgramData\ssh\administrators_authorized_keys"
    Copy-Item $keys $dest -Force
    icacls $dest /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F" | Out-Null
  }
  Restart-Service sshd
}

Step "Standard user for the auto-deny elevation path" {
  if (-not (Get-LocalUser -Name "std" -ErrorAction SilentlyContinue)) {
    $pw = ConvertTo-SecureString "canoe-e2e" -AsPlainText -Force
    New-LocalUser -Name "std" -Password $pw -PasswordNeverExpires -AccountNeverExpires | Out-Null
    Add-LocalGroupMember -Group "Users" -Member "std"
  }
}

Step "UAC golden defaults (EnableLUA stays 1; specs flip the prompt knobs)" {
  $uac = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"
  Set-ItemProperty -Path $uac -Name EnableLUA -Value 1 -Type DWord
  Set-ItemProperty -Path $uac -Name ConsentPromptBehaviorAdmin -Value 0 -Type DWord
  Set-ItemProperty -Path $uac -Name ConsentPromptBehaviorUser -Value 0 -Type DWord
  Set-ItemProperty -Path $uac -Name PromptOnSecureDesktop -Value 1 -Type DWord
}

Step "Keep WebView2 debugging scoped to the harness app" {
  [Environment]::SetEnvironmentVariable("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", $null, "Machine")
}

Set-Content -Path "$root\provisioned" -Value (Get-Date -Format o)
Stop-Transcript | Out-Null
