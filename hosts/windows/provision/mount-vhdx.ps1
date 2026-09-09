# Create and attach the fake device as a VHDX, and report the \\.\PhysicalDriveN
# path the app addresses it by.
param([long] $SizeBytes = 268435456)
$path = "C:\canoe\fake-device.vhdx"
Dismount-DiskImage -ImagePath $path -ErrorAction SilentlyContinue | Out-Null
Remove-Item $path -ErrorAction SilentlyContinue
New-VHD -Path $path -SizeBytes $SizeBytes -Fixed -ErrorAction Stop | Out-Null
Mount-DiskImage -ImagePath $path -StorageType VHDX -Access ReadWrite | Out-Null
$disk = Get-DiskImage -ImagePath $path | Get-Disk
"\\.\PhysicalDrive$($disk.Number)"
