<# Offline rekey for a stopped Minima Core H2 wallet database. Never prints either password. #>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$NodePath,
  [Parameter(Mandatory = $true)]
  [int]$RpcPort
)

$ErrorActionPreference = 'Stop'
$Java = 'C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot\bin\java.exe'
$resolvedNode = [IO.Path]::GetFullPath($NodePath)
$allowedRoot = [IO.Path]::GetFullPath('C:\Users\Charles\Documents\Crypto\Minima\Nodes')
if (-not $resolvedNode.StartsWith($allowedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Node path escaped the intended Minima Nodes directory.'
}
if (-not (Test-Path -LiteralPath $resolvedNode -PathType Container)) { throw 'Node directory is missing.' }
if (Get-NetTCPConnection -State Listen -LocalPort $RpcPort -ErrorAction SilentlyContinue) {
  throw "RPC port $RpcPort is listening. Refusing offline wallet rekey."
}

$jar = Join-Path $resolvedNode 'minima.jar'
$passwordFile = Join-Path $resolvedNode 'dbpassword.local.txt'
$walletDirectory = Join-Path $resolvedNode 'data\1.1\databases\walletsql'
$walletFile = Join-Path $walletDirectory 'wallet.mv.db'
foreach ($required in @($Java, $jar, $passwordFile, $walletFile)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required file is missing: $required" }
}

$oldPassword = [IO.File]::ReadAllText($passwordFile).Trim()
if (-not $oldPassword) { throw 'Current database password file is empty.' }
$random = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($random)
$newPassword = [Convert]::ToHexString($random).ToLowerInvariant()
if ($newPassword -eq $oldPassword) { throw 'Generated password unexpectedly matched the current password.' }

$beforeHash = (Get-FileHash -LiteralPath $walletFile -Algorithm SHA256).Hash.ToLowerInvariant()
$startInfo = [Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $Java
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
foreach ($argument in @('-cp', $jar, 'org.h2.tools.ChangeFileEncryption', '-dir', $walletDirectory,
    '-db', 'wallet', '-cipher', 'AES', '-decrypt', $oldPassword, '-encrypt', $newPassword, '-quiet')) {
  [void]$startInfo.ArgumentList.Add($argument)
}
$process = [Diagnostics.Process]::new()
$process.StartInfo = $startInfo
try {
  if (-not $process.Start()) { throw 'Failed to start H2 ChangeFileEncryption.' }
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    throw "H2 wallet rekey failed with exit code $($process.ExitCode). $stderr $stdout"
  }
} finally {
  $process.Dispose()
}

$afterHash = (Get-FileHash -LiteralPath $walletFile -Algorithm SHA256).Hash.ToLowerInvariant()
if ($afterHash -eq $beforeHash) { throw 'Wallet database bytes did not change after rekey.' }
$temporaryPasswordFile = Join-Path $resolvedNode ('dbpassword.local.' + [Guid]::NewGuid().ToString('N') + '.tmp')
[IO.File]::WriteAllText($temporaryPasswordFile, $newPassword + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
[IO.File]::Move($temporaryPasswordFile, $passwordFile, $true)

[pscustomobject]@{
  node = Split-Path -Leaf $resolvedNode
  walletFile = $walletFile
  walletSha256Before = $beforeHash
  walletSha256After = $afterHash
  replacementPasswordCharacters = $newPassword.Length
  passwordPrinted = $false
  rekeyed = $true
} | ConvertTo-Json -Compress
