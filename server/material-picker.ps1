param(
  [ValidateSet('files', 'folder')]
  [string]$Mode
)

Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$owner = New-Object System.Windows.Forms.Form
$owner.Text = 'Material library picker'
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow
$owner.ShowInTaskbar = $false
$owner.TopMost = $true
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Opacity = 0

try {
  $owner.Show()
  $owner.Activate()
  $owner.BringToFront()

  if ($Mode -eq 'files') {
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = 'Select files for the material library'
    $dialog.Filter = 'All files (*.*)|*.*'
    $dialog.Multiselect = $true
    $dialog.RestoreDirectory = $true
    if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
      @($dialog.FileNames) | ConvertTo-Json -Compress
    } else {
      '[]'
    }
    $dialog.Dispose()
  } else {
    $folderDialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $folderDialog.Description = 'Select a folder for the material library'
    $folderDialog.ShowNewFolderButton = $true
    if ($folderDialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
      @($folderDialog.SelectedPath) | ConvertTo-Json -Compress
    } else {
      '[]'
    }
    $folderDialog.Dispose()
  }
} finally {
  $owner.Close()
  $owner.Dispose()
}
