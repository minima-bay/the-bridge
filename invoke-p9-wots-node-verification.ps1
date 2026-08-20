[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Stale', 'Current')]
    [string]$Mode,

    [Parameter(Mandatory = $true)]
    [string]$JournalDirectory,

    [Parameter(Mandatory = $true)]
    [string]$EvidencePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ResearchRoot = Split-Path -Parent $PSCommandPath
$Verifier = Join-Path $ResearchRoot 'verify-p9-wots-node.mjs'
$CurrentRoot = 'C:\Users\Charles\Documents\Crypto\Minima\Nodes\BridgeTestSigners'
$BackupRoot = 'C:\Users\Charles\Documents\Crypto\Minima\Nodes\BridgeTestSigners-backups'
$StaleSource = Join-Path $BackupRoot 'BridgeTestSigners-pre-p8-resync-20260819T190001Z'
$CloneParent = 'C:\Users\Charles\Documents\Crypto\Minima\P9-Disposable'
$Java = 'C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot\bin\java.exe'
$ExpectedJarHash = 'e8e8b20356d4a688b48d77550fbac2c141107c292af3d9de8ffeb84b3ff8a535'
$ExpectedStaleManifest = '5eec1f0b53485b124741997f72b24cce25167faf7d057e7e9d6ff6d5172d7fb8'
$BasePort = 19701
$RpcPort = $BasePort + 4
$NodeRoot = $null
$CloneRoot = $null
$Process = $null
$RunRoot = $null
$StoppedCleanly = $false
$RpcPassword = $null
$StaleManifestMatched = $false
$JarHashObserved = $null
$NetworkIsolationImplemented = $false

function Assert-ExactChildPath([string]$Candidate, [string]$Parent, [string]$Pattern) {
    $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd('\')
    $candidateFull = [IO.Path]::GetFullPath($Candidate).TrimEnd('\')
    if ([IO.Path]::GetDirectoryName($candidateFull) -ne $parentFull) { throw 'candidate is not an exact child of the disposable parent' }
    if ([IO.Path]::GetFileName($candidateFull) -notmatch $Pattern) { throw 'disposable leaf name is invalid' }
    if ($candidateFull -eq [IO.Path]::GetFullPath($CurrentRoot).TrimEnd('\') -or $candidateFull.StartsWith([IO.Path]::GetFullPath($BackupRoot).TrimEnd('\') + '\')) {
        throw 'disposable path overlaps a protected node or backup'
    }
}

function Test-PortListening([int]$Port) {
    $client = [Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync([Net.IPAddress]::Loopback, $Port)
        return $task.Wait(200) -and $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Assert-PortsClosed {
    foreach ($port in (9701..9705 + 19701..19705)) {
        if (Test-PortListening $port) { throw "required port $port is already listening" }
    }
}

function Get-DeterministicManifest([string]$Directory) {
    $rootFull = [IO.Path]::GetFullPath($Directory).TrimEnd('\')
    $records = [Collections.Generic.List[string]]::new()
    $files = Get-ChildItem -LiteralPath $rootFull -File -Recurse
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($rootFull.Length + 1).Replace('\', '/')
        $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        $records.Add($relative + [char]0 + [string]$file.Length + [char]0 + $hash + "`n")
    }
    $array = $records.ToArray()
    [Array]::Sort($array, [StringComparer]::Ordinal)
    $bytes = [Text.Encoding]::UTF8.GetBytes([string]::Concat($array))
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
}

function Stop-ExactProcess {
    if ($null -eq $Process) { return }
    try {
        $credentialBytes = [Text.Encoding]::UTF8.GetBytes("minima:$RpcPassword")
        $authorization = 'Basic ' + [Convert]::ToBase64String($credentialBytes)
        Invoke-RestMethod -Uri "http://127.0.0.1:$RpcPort/$([Uri]::EscapeDataString('quit'))" -Headers @{ Authorization = $authorization } -TimeoutSec 10 | Out-Null
    } catch {
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    while (-not $Process.HasExited -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 500
        $Process.Refresh()
    }
    if (-not $Process.HasExited) { throw 'node did not stop cleanly; no force-kill or deletion was attempted' }
    foreach ($port in 19701..19705) {
        if (Test-PortListening $port) { throw "isolated port $port remains open after quit" }
    }
    $script:StoppedCleanly = $true
}

try {
    if (-not $NetworkIsolationImplemented) {
        throw 'runner disabled: Core binds the Minima wire port to all interfaces; an authorized, measured inbound-isolation control is required before another clone starts'
    }
    if (@(Get-ChildItem Env: | Where-Object Name -Like 'MINIMA_*').Count -ne 0) { throw 'ambient MINIMA environment variables are not allowed' }
    if (-not (Test-Path -LiteralPath $Java -PathType Leaf)) { throw 'pinned Java executable is missing' }
    if (-not (Test-Path -LiteralPath $Verifier -PathType Leaf)) { throw 'P9 node verifier is missing' }
    Assert-PortsClosed
    $pidPath = Join-Path $CurrentRoot 'node.pid'
    if (Test-Path -LiteralPath $pidPath -PathType Leaf) {
        $recordedPid = 0
        if ([int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$recordedPid) -and (Get-Process -Id $recordedPid -ErrorAction SilentlyContinue)) {
            throw 'the recorded original signer process is still running'
        }
    }

    if ($Mode -eq 'Stale') {
        if (-not (Test-Path -LiteralPath $StaleSource -PathType Container)) { throw 'exact stale backup is missing' }
        $sourceFiles = Get-ChildItem -LiteralPath $StaleSource -File -Recurse
        if ($sourceFiles.Count -ne 23 -or ($sourceFiles | Measure-Object Length -Sum).Sum -ne 630768194) { throw 'stale backup inventory differs' }
        if ((Get-DeterministicManifest $StaleSource) -ne $ExpectedStaleManifest) { throw 'stale backup deterministic manifest differs' }
        New-Item -ItemType Directory -Path $CloneParent -Force | Out-Null
        $CloneRoot = Join-Path $CloneParent ("minima-p9-stale-" + [Guid]::NewGuid().ToString('N'))
        Assert-ExactChildPath $CloneRoot $CloneParent '^minima-p9-stale-[0-9a-f]{32}$'
        Copy-Item -LiteralPath $StaleSource -Destination $CloneRoot -Recurse
        if ((Get-Item -LiteralPath $CloneRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'disposable clone is a reparse point' }
        if ((Get-DeterministicManifest $CloneRoot) -ne $ExpectedStaleManifest) { throw 'disposable clone manifest differs' }
        $StaleManifestMatched = $true
        $NodeRoot = $CloneRoot
    } else {
        $NodeRoot = $CurrentRoot
    }

    $jar = Join-Path $NodeRoot 'minima.jar'
    $JarHashObserved = (Get-FileHash -LiteralPath $jar -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($JarHashObserved -ne $ExpectedJarHash) { throw 'Core jar hash differs' }
    $passwordPath = Join-Path $NodeRoot 'dbpassword.local.txt'
    if (-not (Test-Path -LiteralPath $passwordPath -PathType Leaf)) { throw 'database password file is missing' }
    $password = (Get-Content -LiteralPath $passwordPath -Raw).Trim()
    if ([string]::IsNullOrWhiteSpace($password)) { throw 'database password is empty' }
    $randomBytes = [byte[]]::new(32)
    [Security.Cryptography.RandomNumberGenerator]::Fill($randomBytes)
    $RpcPassword = [Convert]::ToBase64String($randomBytes)
    $RunRoot = Join-Path $CloneParent ("minima-p9-run-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $RunRoot | Out-Null
    $stdout = Join-Path $RunRoot 'stdout.log'
    $stderr = Join-Path $RunRoot 'stderr.log'
    $arguments = @(
        '-jar', $jar,
        '-basefolder', $NodeRoot,
        '-data', (Join-Path $NodeRoot 'data'),
        '-port', [string]$BasePort,
        '-nop2p', 'true',
        '-rpcenable', 'true',
        '-mdsenable', 'false',
        '-nodefaultminidapps', 'true'
    )
    $Process = Start-Process -FilePath $Java -ArgumentList $arguments -Environment @{
        MINIMA_DBPASSWORD = $password
        MINIMA_RPCPASSWORD = $RpcPassword
    } -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $password = $null
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    while (-not (Test-PortListening $RpcPort) -and [DateTime]::UtcNow -lt $deadline) {
        if ($Process.HasExited) { throw 'node exited before isolated RPC became available' }
        Start-Sleep -Milliseconds 500
        $Process.Refresh()
    }
    if (-not (Test-PortListening $RpcPort)) { throw 'isolated RPC did not become available' }
    foreach ($port in 19702..19704) {
        if (Test-PortListening $port) { throw "unexpected service port $port is listening" }
    }
    $expect = if ($Mode -eq 'Stale') { 'COUNTER_ROLLBACK' } else { 'NODE_ACCEPTED_RETIRED' }
    $env:P9_VERIFY_RPCPASSWORD = $RpcPassword
    try {
        & node $Verifier "--mode=inspect" "--rpc=http://127.0.0.1:$RpcPort" "--journal=$JournalDirectory" '--expected-wallet-keys=74' "--expect-code=$expect" "--output=$EvidencePath"
    } finally {
        Remove-Item Env:P9_VERIFY_RPCPASSWORD -ErrorAction SilentlyContinue
    }
    if ($LASTEXITCODE -ne 0) { throw 'P9 node verifier returned an unexpected verdict' }
    Stop-ExactProcess
} finally {
    $password = $null
    Remove-Item Env:P9_VERIFY_RPCPASSWORD -ErrorAction SilentlyContinue
    if ($null -ne $Process -and -not $StoppedCleanly) {
        try { Stop-ExactProcess } catch { }
    }
    if ($null -ne $CloneRoot -and $StoppedCleanly) {
        Assert-ExactChildPath $CloneRoot $CloneParent '^minima-p9-stale-[0-9a-f]{32}$'
        if ((Get-Item -LiteralPath $CloneRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'refusing to remove a reparse-point clone' }
        Remove-Item -LiteralPath $CloneRoot -Recurse -Force
        if (Test-Path -LiteralPath $CloneRoot) { throw 'disposable clone removal failed' }
    }
    if ($null -ne $RunRoot -and (Test-Path -LiteralPath $RunRoot) -and ($null -eq $Process -or $Process.HasExited)) {
        Remove-Item -LiteralPath $RunRoot -Recurse -Force
    }
}

$originalPortsClosed = -not @(9701..9705 | Where-Object { Test-PortListening $_ }).Count
$isolatedPortsClosed = -not @(19701..19705 | Where-Object { Test-PortListening $_ }).Count
$evidence = Get-Content -LiteralPath $EvidencePath -Raw | ConvertFrom-Json
$evidence | Add-Member -NotePropertyName wrapperRun -NotePropertyValue ([ordered]@{
    cleanupRecordedAt = [DateTime]::UtcNow.ToString('o')
    mode = $Mode
    coreJarSha256 = $JarHashObserved
    p2pManagerEnabled = $false
    rpcAuthenticated = $true
    rpcBindObservedBySourceInspection = 'wildcard'
    isolatedBasePort = $BasePort
    isolatedRpcPort = $RpcPort
    staleSourceManifestSha256 = if ($Mode -eq 'Stale') { $ExpectedStaleManifest } else { $null }
    staleCloneManifestMatched = if ($Mode -eq 'Stale') { $StaleManifestMatched } else { $null }
    stoppedCleanly = $StoppedCleanly
    disposableCloneRemoved = if ($Mode -eq 'Stale') { -not (Test-Path -LiteralPath $CloneRoot) } else { $null }
    originalPortsClosed = $originalPortsClosed
    isolatedPortsClosed = $isolatedPortsClosed
    commandAllowlist = @('keys action:list', 'quit')
})
$serialized = ($evidence | ConvertTo-Json -Depth 20) + "`n"
[IO.File]::WriteAllText($EvidencePath, $serialized, [Text.UTF8Encoding]::new($false))
$evidenceHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($serialized))).ToLowerInvariant()
[IO.File]::WriteAllText("$EvidencePath.sha256", "$evidenceHash  $([IO.Path]::GetFileName($EvidencePath))`n", [Text.UTF8Encoding]::new($false))
$RpcPassword = $null

[pscustomobject]@{
    schema = 'generic-p9-wots-node-run/v1'
    mode = $Mode
    stoppedCleanly = $StoppedCleanly
    disposableCloneRemoved = ($Mode -eq 'Stale' -and -not (Test-Path -LiteralPath $CloneRoot))
    signaturesCreated = 0
    transactionCommandsExecuted = 0
    p2pManagerEnabled = $false
}
