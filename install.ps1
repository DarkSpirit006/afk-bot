$ErrorActionPreference = 'Stop'

$launchDir = (Get-Location).ProviderPath
$currentProject = Join-Path $launchDir 'setup.js'
$appDir = $launchDir
$repoUrl = if ($env:AFK_BOT_REPO) { $env:AFK_BOT_REPO } else { 'https://github.com/DarkSpirit006/afk-bot.git' }
# Updated to this branch by .github/workflows/sync-installer-branch.yml.
$defaultRepoBranch = 'main'
$repoBranch = if ($env:AFK_BOT_BRANCH) { $env:AFK_BOT_BRANCH } else { $defaultRepoBranch }
$runtimeDir = Join-Path $env:TEMP 'minecraft-afk-bot-node'

function Get-NodeCommand {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($node -and $npm) { return @{ Node = $node.Source; Npm = $npm.Source } }
  if (-not (Test-Path $runtimeDir)) { New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null }
  $arch = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
  $version = 'v22.14.0'
  $zipName = "node-$version-win-$arch.zip"
  $zipPath = Join-Path $runtimeDir $zipName
  if (-not (Test-Path $zipPath)) { Write-Host "Downloading portable Node.js ($arch)..."; Invoke-WebRequest -Uri "https://nodejs.org/dist/$version/$zipName" -OutFile $zipPath }
  $nodeRoot = Join-Path $runtimeDir "node-$version-win-$arch"
  if (-not (Test-Path (Join-Path $nodeRoot 'node.exe'))) { Expand-Archive -Path $zipPath -DestinationPath $runtimeDir -Force }
  return @{ Node = Join-Path $nodeRoot 'node.exe'; Npm = Join-Path $nodeRoot 'npm.cmd' }
}

$commands = Get-NodeCommand
Write-Host "Install directory: $launchDir"
function Merge-Checkout($sourceDir) {
  Get-ChildItem -LiteralPath $sourceDir -Force | ForEach-Object {
    $destination = Join-Path $appDir $_.Name
    if (Test-Path -LiteralPath $destination) {
      Write-Host "Keeping existing $destination; merge it manually if needed."
    }
    else {
      Move-Item -LiteralPath $_.FullName -Destination $appDir
    }
  }
  if ((Get-ChildItem -LiteralPath $sourceDir -Force | Measure-Object).Count -eq 0) {
    Remove-Item -LiteralPath $sourceDir -Force
  }
  else {
    Write-Host "Some files remain in $sourceDir because matching files already existed."
  }
}

if (-not (Test-Path (Join-Path $appDir 'setup.js'))) {
  # Migrate installations created by older installers into the launch directory.
  foreach ($legacyName in @('minecraft-afk-bot', 'afk-bot')) {
    $legacyDir = Join-Path $launchDir $legacyName
    if (Test-Path (Join-Path $legacyDir 'setup.js')) {
      Merge-Checkout $legacyDir
      Write-Host "Migrated the previous $legacyName installation into the current directory."
      break
    }
  }
}
if (-not (Test-Path (Join-Path $appDir 'setup.js'))) {
  if (-not $repoUrl) { throw 'Set AFK_BOT_REPO to the repository URL, or run this script from the project directory.' }
  if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { throw 'Git is required to download the project.' }
  New-Item -ItemType Directory -Path $appDir -Force | Out-Null
  if ((Get-ChildItem -LiteralPath $appDir -Force | Measure-Object).Count -gt 0) {
    $downloadDir = Join-Path $env:TEMP ("afk-bot-" + [guid]::NewGuid().ToString())
    & git.exe clone --branch $repoBranch $repoUrl $downloadDir
    Merge-Checkout $downloadDir
  }
  else {
    & git.exe clone --branch $repoBranch $repoUrl $appDir
  }
}
elseif (Test-Path (Join-Path $appDir '.git')) {
  $installedBranch = (& git.exe -C $appDir branch --show-current).Trim()
  if (-not $installedBranch) { throw 'Cannot update a detached Git checkout. Check out the branch originally used for installation first.' }
  if ($installedBranch -ne $repoBranch) {
    $localChanges = (& git.exe -C $appDir status --porcelain)
    $stashCreated = $false
    if ($localChanges) {
      $stashName = "installer-switch-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))"
      Write-Host "Stashing local changes before switching branches..."
      & git.exe -C $appDir stash push --include-untracked -m $stashName | Out-Null
      $stashCreated = $true
    }
    Write-Host "Switching checkout from $installedBranch to installer branch $repoBranch..."
    & git.exe -C $appDir fetch origin $repoBranch | Out-Null
    $checkoutOutput = $null
    try {
      $checkoutOutput = & git.exe -C $appDir checkout $repoBranch 2>&1
      $checkoutExitCode = 0
    }
    catch {
      $checkoutExitCode = 1
      $checkoutOutput = $_.Exception.Message
    }
    if ($checkoutExitCode -ne 0) {
      if ($checkoutOutput -match 'already exists') {
        Write-Host "Branch $repoBranch already exists locally; continuing..."
      }
      else {
        & git.exe -C $appDir checkout -b $repoBranch "origin/$repoBranch"
      }
    }
    if ($stashCreated) {
      Write-Host "Restoring stashed changes..."
      & git.exe -C $appDir stash pop 2>$null
      if ($LASTEXITCODE) { Write-Warning "Some stashed changes could not be reapplied automatically; resolve them manually." }
    }
  }
  $installedBranch = $repoBranch
  Write-Host "Updating only from origin/$installedBranch..."
  & git.exe -C $appDir pull --ff-only origin $installedBranch
}

Push-Location $appDir
try {
  $env:Path = "$(Split-Path $commands.Node);$env:Path"
  & $commands.Node setup.js
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
}
finally { Pop-Location }

