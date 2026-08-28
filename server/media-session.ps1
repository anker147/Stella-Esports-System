param(
  [ValidateSet('status', 'toggle', 'play', 'pause', 'previous', 'next', 'set-volume')]
  [string]$Action = 'status',
  [ValidateRange(0, 100)]
  [int]$Volume = 50
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -Path (Join-Path $PSScriptRoot 'CloudMusicAudio.cs')

if ($Action -eq 'set-volume') {
  $changed = [CloudMusicAudio]::SetVolume('cloudmusic', $Volume)
  if (-not $changed) { $changed = [CloudMusicAudio]::SetVolumeByShortcut('cloudmusic', $Volume) }
  [ordered]@{
    available = $changed
    volume = if ($changed) {
      $nativeVolume = [CloudMusicAudio]::GetVolume('cloudmusic')
      if ($nativeVolume -ge 0) { $nativeVolume } else { $Volume }
    } else { $null }
  } | ConvertTo-Json -Compress
  exit 0
}

function Await-Operation($Operation, [Type]$ResultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait()
  return $task.Result
}

$session = $null
try {
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $manager = Await-Operation ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  $session = $manager.GetSessions() |
    Where-Object { $_.SourceAppUserModelId -match '(?i)cloudmusic|netease|orpheus' } |
    Select-Object -First 1
} catch {
  $session = $null
}

if (-not $session) {
  $windowTitle = [CloudMusicAudio]::GetTrackTitle('cloudmusic')
  $separator = if ($windowTitle) { $windowTitle.LastIndexOf(' - ') } else { -1 }
  if ($separator -gt 0) {
    $isPlaying = [CloudMusicAudio]::IsPlaying('cloudmusic')
    if ($Action -eq 'toggle') {
      [void][CloudMusicAudio]::SendMediaCommand('cloudmusic', 'toggle')
    } elseif ($Action -eq 'play' -and -not $isPlaying) {
      [void][CloudMusicAudio]::SendMediaCommand('cloudmusic', 'toggle')
    } elseif ($Action -eq 'pause' -and $isPlaying) {
      [void][CloudMusicAudio]::SendMediaCommand('cloudmusic', 'toggle')
    } elseif ($Action -eq 'previous' -or $Action -eq 'next') {
      [void][CloudMusicAudio]::SendMediaCommand('cloudmusic', $Action)
    }
    if ($Action -ne 'status') { Start-Sleep -Milliseconds 180 }
    $windowTitle = [CloudMusicAudio]::GetTrackTitle('cloudmusic')
    $separator = $windowTitle.LastIndexOf(' - ')
    $currentVolume = [CloudMusicAudio]::GetVolume('cloudmusic')
    $isPlaying = [CloudMusicAudio]::IsPlaying('cloudmusic')
    [ordered]@{
      available = $true
      source = 'cloudmusic-window'
      title = $windowTitle.Substring(0, $separator)
      artist = $windowTitle.Substring($separator + 3)
      album = $null
      playing = if ($Action -eq 'status') { $true } else { $isPlaying }
      playbackStatus = 'unknown'
      positionSeconds = 0
      durationSeconds = 0
      volume = if ($currentVolume -ge 0) { $currentVolume } else { 50 }
    } | ConvertTo-Json -Compress
    exit 0
  }
  $currentVolume = [CloudMusicAudio]::GetVolume('cloudmusic')
  [ordered]@{
    available = $false
    source = $null
    title = $null
    artist = $null
    album = $null
    playing = $false
    playbackStatus = 'closed'
    volume = if ($currentVolume -ge 0) { $currentVolume } else { $null }
  } | ConvertTo-Json -Compress
  exit 0
}

$playback = $session.GetPlaybackInfo().PlaybackStatus.ToString().ToLowerInvariant()
if ($Action -eq 'toggle') {
  $operation = if ($playback -eq 'playing') { $session.TryPauseAsync() } else { $session.TryPlayAsync() }
  [void](Await-Operation $operation ([bool]))
} elseif ($Action -eq 'play') {
  [void](Await-Operation ($session.TryPlayAsync()) ([bool]))
} elseif ($Action -eq 'pause') {
  [void](Await-Operation ($session.TryPauseAsync()) ([bool]))
} elseif ($Action -eq 'previous') {
  [void](Await-Operation ($session.TrySkipPreviousAsync()) ([bool]))
} elseif ($Action -eq 'next') {
  [void](Await-Operation ($session.TrySkipNextAsync()) ([bool]))
}

if ($Action -ne 'status') {
  Start-Sleep -Milliseconds 120
  $playback = $session.GetPlaybackInfo().PlaybackStatus.ToString().ToLowerInvariant()
}
$properties = Await-Operation ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
$timeline = $session.GetTimelineProperties()

[ordered]@{
  available = $true
  source = $session.SourceAppUserModelId
  title = $properties.Title
  artist = $properties.Artist
  album = $properties.AlbumTitle
  playing = $playback -eq 'playing'
  playbackStatus = $playback
  positionSeconds = [math]::Max(0, [math]::Floor($timeline.Position.TotalSeconds))
  durationSeconds = [math]::Max(0, [math]::Floor($timeline.EndTime.TotalSeconds))
  volume = $(
    $currentVolume = [CloudMusicAudio]::GetVolume('cloudmusic')
    if ($currentVolume -ge 0) { $currentVolume } else { $null }
  )
} | ConvertTo-Json -Compress
