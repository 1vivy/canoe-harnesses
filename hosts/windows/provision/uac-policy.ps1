# Set how the guest answers an elevation request. EnableLUA stays 1 throughout:
# turning UAC off entirely would not exercise the app's elevation path at all.
param([ValidateSet("auto-elevate", "prompt-accept", "prompt-cancel", "auto-deny", "agent-unavailable")] [string] $Policy)
$key = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"
Set-ItemProperty -Path $key -Name EnableLUA -Value 1 -Type DWord
switch ($Policy) {
  "auto-elevate" {
    # An administrator elevates with no prompt at all.
    Set-ItemProperty -Path $key -Name ConsentPromptBehaviorAdmin -Value 0 -Type DWord
    Set-ItemProperty -Path $key -Name PromptOnSecureDesktop -Value 1 -Type DWord
  }
  { $_ -in "prompt-accept", "prompt-cancel" } {
    # Real consent on the secure desktop, driven through virtual keyboard input.
    Set-ItemProperty -Path $key -Name ConsentPromptBehaviorAdmin -Value 2 -Type DWord
    Set-ItemProperty -Path $key -Name PromptOnSecureDesktop -Value 1 -Type DWord
  }
  "auto-deny" {
    # A standard user whose elevation requests are refused without any prompt.
    Set-ItemProperty -Path $key -Name ConsentPromptBehaviorUser -Value 0 -Type DWord
    Set-ItemProperty -Path $key -Name PromptOnSecureDesktop -Value 1 -Type DWord
  }
  "agent-unavailable" { throw "agent-unavailable is a Linux-only policy" }
}
Get-ItemProperty -Path $key | Select-Object EnableLUA, ConsentPromptBehaviorAdmin, ConsentPromptBehaviorUser, PromptOnSecureDesktop | Format-List
