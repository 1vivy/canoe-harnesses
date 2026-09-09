@echo off
rem Runs once at first logon of the unattended install (elevated). Everything
rem of substance is in setup.ps1 so it can be re-run by hand over SSH.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
