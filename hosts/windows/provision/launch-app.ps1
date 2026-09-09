# Runs an explicitly selected program on an existing interactive desktop.
# Setup/login and UAC policy are independent, explicit fixture operations.
param(
  [Parameter(Mandatory=$true)] [string] $Executable,
  [string] $Arguments = "",
  [string] $User = "canoe",
  [string] $TaskName = "canoe-harness-app",
  [string] $EnvironmentJson = "{}",
  [string] $StateRoot = "C:\canoe"
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw "Executable does not exist: $Executable" }
if ($TaskName -notmatch '^[a-zA-Z0-9_.-]+$') { throw "Invalid task name" }
New-Item -ItemType Directory -Force -Path "$StateRoot\logs" | Out-Null
$launcher = Join-Path $StateRoot "$TaskName.ps1"
$environment = $EnvironmentJson | ConvertFrom-Json
$lines = @('$ErrorActionPreference = ''Stop''')
foreach ($property in $environment.PSObject.Properties) {
  if ($property.Name -notmatch '^[a-zA-Z_][a-zA-Z0-9_]*$') { throw "Invalid environment name" }
  $value = ([string]$property.Value).Replace("'", "''")
  $lines += "`$env:$($property.Name) = '$value'"
}
$exe = $Executable.Replace("'", "''")
$arg = $Arguments.Replace("'", "''")
$out = (Join-Path "$StateRoot\logs" "$TaskName.out.log").Replace("'", "''")
$err = (Join-Path "$StateRoot\logs" "$TaskName.err.log").Replace("'", "''")
$lines += "Start-Process -FilePath '$exe' -ArgumentList '$arg' -RedirectStandardOutput '$out' -RedirectStandardError '$err' -Wait"
Set-Content -LiteralPath $launcher -Value $lines -Encoding UTF8
$principal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$User" -LogonType Interactive -RunLevel Limited
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$launcher`""
Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
"started $TaskName"
