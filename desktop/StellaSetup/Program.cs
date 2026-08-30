using System.Diagnostics;
using System.IO.Compression;
using System.IO.Pipes;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;

namespace StellaSetup;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Contains("--silent"))
        {
            RunSilent(args);
            return;
        }
        ApplicationConfiguration.Initialize();
        Application.Run(new SetupForm());
    }

    private static void RunSilent(string[] args)
    {
        var installDir = ArgumentValue(args, "--install-dir") ?? throw new ArgumentException("--install-dir is required");
        var resultFile = ArgumentValue(args, "--result-file");
        try
        {
            var result = InstallerEngine.InstallAsync(installDir, false, false, new Progress<InstallProgress>()).GetAwaiter().GetResult();
            if (resultFile is not null) File.WriteAllText(resultFile, result, new UTF8Encoding(false));
            Environment.ExitCode = 0;
        }
        catch (Exception error)
        {
            if (resultFile is not null) File.WriteAllText(resultFile, error.ToString(), new UTF8Encoding(false));
            Environment.ExitCode = 1;
        }
    }

    private static string? ArgumentValue(string[] args, string name)
    {
        var index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }
}

internal sealed class SetupForm : Form
{
    private readonly TextBox _installPath = new();
    private readonly Button _browse = new();
    private readonly Button _install = new();
    private readonly ProgressBar _progress = new();
    private readonly Label _status = new();
    private readonly Label _mode = new();
    private readonly CheckBox _desktopShortcut = new();
    private readonly CheckBox _autoStart = new();
    private string? _installedVersion;

    public SetupForm()
    {
        Text = "星澜赛事导播系统 安装程序";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        ClientSize = new Size(650, 390);
        BackColor = Color.FromArgb(247, 249, 251);
        Font = new Font("Microsoft YaHei UI", 9F);

        var title = new Label { Text = "星澜赛事导播系统", Font = new Font(Font.FontFamily, 20F, FontStyle.Bold), AutoSize = true, Location = new Point(34, 28) };
        var subtitle = new Label { Text = "OBS WebSocket 赛事导播控制台", ForeColor = Color.DimGray, AutoSize = true, Location = new Point(38, 72) };
        _mode.AutoSize = true;
        _mode.Font = new Font(Font.FontFamily, 10F, FontStyle.Bold);
        _mode.ForeColor = Color.FromArgb(0, 95, 184);
        _mode.Location = new Point(38, 110);
        var pathLabel = new Label { Text = "安装位置", AutoSize = true, Location = new Point(38, 151) };
        _installPath.Location = new Point(38, 176);
        _installPath.Size = new Size(478, 28);
        _browse.Text = "浏览...";
        _browse.Location = new Point(526, 174);
        _browse.Size = new Size(84, 30);
        _browse.Click += (_, _) => Browse();
        _desktopShortcut.Text = "创建桌面快捷方式";
        _desktopShortcut.Checked = true;
        _desktopShortcut.AutoSize = true;
        _desktopShortcut.Location = new Point(38, 221);
        _autoStart.Text = "开机时在托盘启动";
        _autoStart.AutoSize = true;
        _autoStart.Location = new Point(220, 221);
        _progress.Location = new Point(38, 266);
        _progress.Size = new Size(572, 18);
        _status.Text = "准备就绪";
        _status.AutoEllipsis = true;
        _status.Location = new Point(38, 294);
        _status.Size = new Size(440, 45);
        _status.ForeColor = Color.DimGray;
        _install.Text = "安装";
        _install.BackColor = Color.FromArgb(0, 120, 212);
        _install.ForeColor = Color.White;
        _install.FlatStyle = FlatStyle.Flat;
        _install.FlatAppearance.BorderSize = 0;
        _install.Size = new Size(120, 40);
        _install.Location = new Point(490, 320);
        _install.Click += async (_, _) => await InstallAsync();
        Controls.AddRange([title, subtitle, _mode, pathLabel, _installPath, _browse, _desktopShortcut, _autoStart, _progress, _status, _install]);
        DetectInstallation();
    }

    private void DetectInstallation()
    {
        var installed = InstallerEngine.FindExistingInstallation();
        if (installed is not null)
        {
            _installedVersion = installed.Version;
            _installPath.Text = installed.InstallDir;
            _installPath.ReadOnly = true;
            _browse.Enabled = false;
            _mode.Text = installed.Registered
                ? $"检测到版本 {_installedVersion}，将沿用原路径执行增量更新"
                : $"检测到旧安装 {_installedVersion}，将接管原路径并补齐卸载入口";
            _install.Text = "更新";
        }
        else
        {
            _installPath.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "StellaDirector");
            _mode.Text = "全新安装，可指定安装位置";
        }
    }

    private void Browse()
    {
        using var dialog = new FolderBrowserDialog { Description = "选择星澜赛事导播系统安装位置", UseDescriptionForTitle = true, SelectedPath = _installPath.Text };
        if (dialog.ShowDialog() == DialogResult.OK) _installPath.Text = Path.Combine(dialog.SelectedPath, "StellaDirector");
    }

    private async Task InstallAsync()
    {
        var installDir = Path.GetFullPath(_installPath.Text.Trim());
        if (string.IsNullOrWhiteSpace(_installPath.Text) || Path.GetPathRoot(installDir) == installDir)
        {
            MessageBox.Show("请选择具体的软件安装文件夹，不能直接安装到磁盘根目录。", "安装位置无效", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        SetBusy(true);
        try
        {
            var progress = new Progress<InstallProgress>(value =>
            {
                _status.Text = value.Message;
                _progress.Value = Math.Clamp(value.Percent, 0, 100);
            });
            var result = await InstallerEngine.InstallAsync(installDir, _desktopShortcut.Checked, _autoStart.Checked, progress);
            _status.Text = result;
            _progress.Value = 100;
            MessageBox.Show(result, "安装完成", MessageBoxButtons.OK, MessageBoxIcon.Information);
            Close();
        }
        catch (Exception ex)
        {
            _status.Text = ex.Message;
            MessageBox.Show($"安装失败，已尝试恢复原版本。\n\n{ex.Message}", "安装失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally { SetBusy(false); }
    }

    private void SetBusy(bool busy)
    {
        _install.Enabled = !busy;
        _browse.Enabled = !busy && !_installPath.ReadOnly;
        _installPath.Enabled = !busy;
        _desktopShortcut.Enabled = !busy;
        _autoStart.Enabled = !busy;
        UseWaitCursor = busy;
    }
}

internal static class InstallerEngine
{
    private const string ProductKey = @"Software\Stella\DirectorSystem";
    private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\StellaDirector";
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    public static InstalledProduct? FindExistingInstallation()
    {
        var candidates = new List<(string? Path, bool Registered)>();
        using (var product = Registry.CurrentUser.OpenSubKey(ProductKey))
            candidates.Add((Convert.ToString(product?.GetValue("InstallDir")), true));
        using (var uninstall = Registry.CurrentUser.OpenSubKey(UninstallKey))
            candidates.Add((Convert.ToString(uninstall?.GetValue("InstallLocation")), true));

        candidates.Add((Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "StellaDirector"), false));
        foreach (var shortcut in InstallationShortcuts())
            candidates.Add((ShortcutInstallDirectory(shortcut), false));
        foreach (var process in Process.GetProcessesByName("StellaDirector"))
        {
            using (process)
            {
                try { candidates.Add((Path.GetDirectoryName(process.MainModule?.FileName), false)); }
                catch { }
            }
        }

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var candidate in candidates)
        {
            if (string.IsNullOrWhiteSpace(candidate.Path)) continue;
            string fullPath;
            try { fullPath = Path.GetFullPath(candidate.Path); }
            catch { continue; }
            if (!seen.Add(fullPath)) continue;
            var inspected = InspectLegacyInstallation(fullPath);
            if (inspected is not null) return inspected with { Registered = candidate.Registered };
        }
        return null;
    }

    private static IEnumerable<string> InstallationShortcuts()
    {
        var fileNames = new[] { "星澜赛事导播系统.lnk", "StellaDirector.lnk" };
        var directories = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu), "Programs")
        };
        return directories.SelectMany(directory => fileNames.Select(fileName => Path.Combine(directory, fileName)))
            .Where(File.Exists);
    }

    private static string? ShortcutInstallDirectory(string shortcutPath)
    {
        object? shell = null;
        object? shortcut = null;
        try
        {
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType is null) return null;
            shell = Activator.CreateInstance(shellType);
            shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, [shortcutPath]);
            var target = Convert.ToString(shortcut?.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, shortcut, null));
            return string.IsNullOrWhiteSpace(target) ? null : Path.GetDirectoryName(target);
        }
        catch { return null; }
        finally
        {
            if (shortcut is not null && System.Runtime.InteropServices.Marshal.IsComObject(shortcut))
                System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shortcut);
            if (shell is not null && System.Runtime.InteropServices.Marshal.IsComObject(shell))
                System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);
        }
    }

    private static InstalledProduct? InspectLegacyInstallation(string installDir)
    {
        try
        {
            if (!Directory.Exists(installDir) || Path.GetPathRoot(installDir) == installDir) return null;
            if ((File.GetAttributes(installDir) & FileAttributes.ReparsePoint) != 0) return null;
            var executable = Path.Combine(installDir, "StellaDirector.exe");
            var manifestPath = Path.Combine(installDir, "payload-manifest.json");
            var versionPath = Path.Combine(installDir, "version.json");
            if (!File.Exists(executable) || !File.Exists(manifestPath) || !File.Exists(versionPath) ||
                !File.Exists(Path.Combine(installDir, "runtime", "node.exe")) ||
                !File.Exists(Path.Combine(installDir, "server", "server.js")) ||
                !File.Exists(Path.Combine(installDir, "public", "control.html"))) return null;
            var manifest = JsonSerializer.Deserialize<PayloadManifest>(File.ReadAllText(manifestPath), JsonOptions);
            using var versionDocument = JsonDocument.Parse(File.ReadAllText(versionPath));
            var versionRoot = versionDocument.RootElement;
            var product = versionRoot.TryGetProperty("product", out var productValue) ? productValue.GetString() : null;
            var version = versionRoot.TryGetProperty("version", out var versionValue) ? versionValue.GetString() : null;
            if (manifest?.Product != "stella-director" || product != "stella-director" ||
                string.IsNullOrWhiteSpace(version) || manifest.Version != version) return null;
            ValidateManifest(manifest);
            return new InstalledProduct(installDir, version, false);
        }
        catch { return null; }
    }

    public static async Task<string> InstallAsync(string installDir, bool desktopShortcut, bool autoStart, IProgress<InstallProgress> progress)
    {
        installDir = Path.GetFullPath(installDir);
        ValidateInstallTarget(installDir);
        progress.Report(new(2, "正在验证安装包..."));
        var installParent = Directory.GetParent(installDir)?.FullName ?? throw new InvalidDataException("安装目录没有有效的父目录");
        Directory.CreateDirectory(installParent);
        var tempRoot = Path.Combine(installParent, $".stella-setup-{Guid.NewGuid():N}");
        var staging = Path.Combine(tempRoot, "payload");
        Directory.CreateDirectory(staging);
        try
        {
            await StopRunningApplicationAsync(installDir);
            ExtractPayload(staging);
            var manifestPath = Path.Combine(staging, "payload-manifest.json");
            var manifest = JsonSerializer.Deserialize<PayloadManifest>(await File.ReadAllTextAsync(manifestPath), JsonOptions)
                ?? throw new InvalidDataException("安装包清单无效");
            ValidateManifest(manifest);
            progress.Report(new(10, $"正在准备版本 {manifest.Version}..."));

            using var productKey = Registry.CurrentUser.CreateSubKey(ProductKey);
            var dataDir = Path.Combine(installDir, "user-data", "data");
            var stateRoot = Path.Combine(installDir, "user-data");
            var stateRootExisted = Directory.Exists(stateRoot);
            var backupRoot = Path.Combine(stateRoot, "backups", $"{DateTime.Now:yyyyMMdd-HHmmss}-{manifest.Version}");
            var dataBackupRoot = Path.Combine(backupRoot, "user-data-backup");
            var dataDirExisted = Directory.Exists(dataDir);
            var updateStaging = Path.Combine(stateRoot, "updates", $"staging-{Guid.NewGuid():N}");
            Directory.CreateDirectory(updateStaging);

            var oldManifest = ReadInstalledManifest(installDir);
            var freshInstall = oldManifest is null && !File.Exists(Path.Combine(installDir, "StellaDirector.exe"));
            var changed = new List<PayloadFile>();
            var skipped = 0;
            for (var index = 0; index < manifest.Files.Count; index++)
            {
                var file = manifest.Files[index];
                var destination = SafePath(installDir, file.Path);
                if (File.Exists(destination) && HashFile(destination).Equals(file.Sha256, StringComparison.OrdinalIgnoreCase)) skipped++;
                else changed.Add(file);
                progress.Report(new(10 + index * 20 / Math.Max(1, manifest.Files.Count), $"正在比较文件：{file.Path}"));
            }
            var obsolete = oldManifest?.Files.Where(old => manifest.Files.All(next => !next.Path.Equals(old.Path, StringComparison.OrdinalIgnoreCase))).ToList() ?? [];

            progress.Report(new(32, $"发现 {changed.Count} 个变化文件，{skipped} 个文件无需更新"));
            foreach (var file in changed)
            {
                var source = SafePath(staging, file.Path);
                if (!File.Exists(source) || !HashFile(source).Equals(file.Sha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException($"安装文件校验失败：{file.Path}");
                var staged = SafePath(updateStaging, file.Path);
                Directory.CreateDirectory(Path.GetDirectoryName(staged)!);
                File.Copy(source, staged, true);
            }

            var restored = new List<string>();
            var created = new List<string>();
            if (dataDirExisted) CopyOwnedTree(dataDir, dataBackupRoot);
            try
            {
                var operationCount = changed.Count + obsolete.Count;
                var completed = 0;
                foreach (var file in changed)
                {
                    var destination = SafePath(installDir, file.Path);
                    if (File.Exists(destination)) BackupFile(installDir, backupRoot, file.Path, restored);
                    else created.Add(file.Path);
                    var source = SafePath(updateStaging, file.Path);
                    Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                    var temporary = $"{destination}.update-{Guid.NewGuid():N}";
                    File.Copy(source, temporary, true);
                    File.Move(temporary, destination, true);
                    completed++;
                    progress.Report(new(35 + completed * 35 / Math.Max(1, operationCount), $"正在更新：{file.Path}"));
                }
                foreach (var file in obsolete)
                {
                    var destination = SafePath(installDir, file.Path);
                    if (File.Exists(destination))
                    {
                        BackupFile(installDir, backupRoot, file.Path, restored);
                        File.Delete(destination);
                    }
                    completed++;
                }

                progress.Report(new(75, "正在启动并检查新版本..."));
                var tray = Path.Combine(installDir, "StellaDirector.exe");
                Process.Start(new ProcessStartInfo(tray, "--background") { UseShellExecute = true, WorkingDirectory = installDir });
                if (!await WaitForHealthAsync(manifest.Version, dataDir, TimeSpan.FromSeconds(20))) throw new InvalidOperationException("新版本后台健康检查失败或端口被其他实例占用");
                var installedManifest = Path.Combine(installDir, "payload-manifest.json");
                await File.WriteAllTextAsync(installedManifest, JsonSerializer.Serialize(manifest, JsonOptions), new UTF8Encoding(false));
                RegisterInstallation(installDir, dataDir, manifest.Version, desktopShortcut, autoStart);
                progress.Report(new(96, "健康检查通过，正在清理临时文件..."));
                TrimBackups(Path.Combine(stateRoot, "backups"), 2);
                return changed.Count == 0 && obsolete.Count == 0
                    ? $"版本 {manifest.Version} 校验完成，程序文件均为最新。"
                    : $"版本 {manifest.Version} 安装完成：更新 {changed.Count} 个文件，复用 {skipped} 个未变化文件。";
            }
            catch
            {
                await StopRunningApplicationAsync(installDir);
                foreach (var relative in created)
                {
                    await DeleteFileWithRetryAsync(SafePath(installDir, relative));
                }
                RestoreBackup(installDir, backupRoot, restored);
                if (dataDirExisted)
                {
                    try
                    {
                        if (Directory.Exists(dataDir)) DeleteOwnedTree(dataDir);
                        CopyOwnedTree(dataBackupRoot, dataDir);
                    }
                    catch { }
                }
                if (freshInstall)
                {
                    try { Registry.CurrentUser.DeleteSubKeyTree(ProductKey, false); } catch { }
                    try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\StellaDirector", false); } catch { }
                    if (!stateRootExisted) DeleteOwnedTree(stateRoot);
                    DeleteEmptyDirectories(installDir);
                }
                throw;
            }
            finally
            {
                try { Directory.Delete(updateStaging, true); } catch { }
            }
        }
        finally
        {
            try { Directory.Delete(tempRoot, true); } catch { }
        }
    }

    private static void ExtractPayload(string destination)
    {
        using var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("Stella.Payload.zip")
            ?? throw new InvalidOperationException("安装包缺少内置程序文件");
        using var archive = new ZipArchive(payload, ZipArchiveMode.Read);
        foreach (var entry in archive.Entries)
        {
            if (string.IsNullOrEmpty(entry.Name)) continue;
            var target = SafePath(destination, entry.FullName.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            entry.ExtractToFile(target, true);
        }
    }

    private static void ValidateManifest(PayloadManifest manifest)
    {
        if (manifest.Product != "stella-director" || string.IsNullOrWhiteSpace(manifest.Version) || manifest.Files.Count == 0)
            throw new InvalidDataException("安装包产品或版本清单无效");
        foreach (var file in manifest.Files)
        {
            if (Path.IsPathRooted(file.Path) || file.Path.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).Contains("..") || file.Sha256.Length != 64)
                throw new InvalidDataException($"安装包包含不安全路径：{file.Path}");
        }
    }

    private static void ValidateInstallTarget(string installDir)
    {
        if (Path.GetPathRoot(installDir)?.TrimEnd(Path.DirectorySeparatorChar) == installDir.TrimEnd(Path.DirectorySeparatorChar))
            throw new InvalidDataException("不能安装到磁盘根目录");
        if (!Directory.Exists(installDir)) return;
        if ((File.GetAttributes(installDir) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("安装目录不能是符号链接或目录联接");
        if (!Directory.EnumerateFileSystemEntries(installDir).Any()) return;
        var manifest = ReadInstalledManifest(installDir);
        if (manifest?.Product != "stella-director" && InspectLegacyInstallation(installDir) is null)
            throw new InvalidDataException("所选目录不是空目录，也不是有效的星澜赛事导播系统安装目录。请选择专用文件夹。");
    }

    private static PayloadManifest? ReadInstalledManifest(string installDir)
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(ProductKey);
            var registeredDir = Convert.ToString(key?.GetValue("InstallDir"));
            var expectedHash = Convert.ToString(key?.GetValue("ManifestSha256"));
            var manifestPath = Path.Combine(installDir, "payload-manifest.json");
            if (string.IsNullOrWhiteSpace(registeredDir) || string.IsNullOrWhiteSpace(expectedHash)) return null;
            if (!Path.GetFullPath(registeredDir).Equals(Path.GetFullPath(installDir), StringComparison.OrdinalIgnoreCase)) return null;
            if (!File.Exists(manifestPath) || !HashFile(manifestPath).Equals(expectedHash, StringComparison.OrdinalIgnoreCase)) return null;
            return JsonSerializer.Deserialize<PayloadManifest>(File.ReadAllText(manifestPath), JsonOptions);
        }
        catch { return null; }
    }

    private static string SafePath(string root, string relative)
    {
        var rootPath = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var result = Path.GetFullPath(Path.Combine(rootPath, relative));
        if (!result.StartsWith(rootPath, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException($"路径越界：{relative}");
        var rootDirectory = rootPath.TrimEnd(Path.DirectorySeparatorChar);
        if (Directory.Exists(rootDirectory) && (File.GetAttributes(rootDirectory) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException($"路径包含重解析点：{relative}");
        var cursor = rootDirectory;
        foreach (var segment in Path.GetRelativePath(rootDirectory, result).Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
        {
            cursor = Path.Combine(cursor, segment);
            if ((File.Exists(cursor) || Directory.Exists(cursor)) && (File.GetAttributes(cursor) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException($"路径包含重解析点：{relative}");
        }
        return result;
    }

    private static string HashFile(string filePath)
    {
        using var stream = File.OpenRead(filePath);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }

    private static void BackupFile(string installDir, string backupRoot, string relative, List<string> restored)
    {
        var source = SafePath(installDir, relative);
        var target = SafePath(backupRoot, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        File.Copy(source, target, true);
        restored.Add(relative);
    }

    private static void RestoreBackup(string installDir, string backupRoot, IEnumerable<string> restored)
    {
        foreach (var relative in restored.Reverse())
        {
            try
            {
                var source = SafePath(backupRoot, relative);
                var target = SafePath(installDir, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                File.Copy(source, target, true);
            }
            catch { }
        }
    }

    private static async Task StopRunningApplicationAsync(string installDir)
    {
        try
        {
            using var pipe = new NamedPipeClientStream(".", "StellaDirector.Control", PipeDirection.InOut);
            await pipe.ConnectAsync(1200);
            await using var writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true) { AutoFlush = true };
            await writer.WriteLineAsync("exit-for-update");
            await Task.Delay(2000);
        }
        catch { }

        var expectedExecutable = Path.GetFullPath(Path.Combine(installDir, "StellaDirector.exe"));
        foreach (var process in Process.GetProcessesByName("StellaDirector"))
        {
            using (process)
            {
                try
                {
                    var executable = process.MainModule?.FileName;
                    if (executable is null || !Path.GetFullPath(executable).Equals(expectedExecutable, StringComparison.OrdinalIgnoreCase)) continue;
                    if (!process.WaitForExit(5000))
                    {
                        process.Kill(true);
                        process.WaitForExit(5000);
                    }
                }
                catch { }
            }
        }
    }

    private static async Task DeleteFileWithRetryAsync(string path)
    {
        for (var attempt = 0; attempt < 8 && File.Exists(path); attempt++)
        {
            try { File.Delete(path); }
            catch { if (attempt < 7) await Task.Delay(250 * (attempt + 1)); }
        }
    }

    private static void DeleteEmptyDirectories(string installDir)
    {
        if (!Directory.Exists(installDir)) return;
        foreach (var directory in Directory.GetDirectories(installDir, "*", SearchOption.AllDirectories).OrderByDescending(path => path.Length))
        {
            try { if (!Directory.EnumerateFileSystemEntries(directory).Any()) Directory.Delete(directory); } catch { }
        }
        try { if (!Directory.EnumerateFileSystemEntries(installDir).Any()) Directory.Delete(installDir); } catch { }
    }

    private static void CopyOwnedTree(string source, string destination)
    {
        if (!Directory.Exists(source)) return;
        var root = new DirectoryInfo(source);
        if ((root.Attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("用户数据目录不能是符号链接或目录联接");
        Directory.CreateDirectory(destination);
        foreach (var entry in root.EnumerateFileSystemInfos())
        {
            if ((entry.Attributes & FileAttributes.ReparsePoint) != 0) continue;
            var target = Path.Combine(destination, entry.Name);
            if (entry is DirectoryInfo child) CopyOwnedTree(child.FullName, target);
            else File.Copy(entry.FullName, target, true);
        }
    }

    private static void DeleteOwnedTree(string path)
    {
        if (!Directory.Exists(path)) return;
        var directory = new DirectoryInfo(path);
        if ((directory.Attributes & FileAttributes.ReparsePoint) != 0)
        {
            directory.Delete();
            return;
        }
        foreach (var entry in directory.EnumerateFileSystemInfos())
        {
            if ((entry.Attributes & FileAttributes.ReparsePoint) != 0) entry.Delete();
            else if (entry is DirectoryInfo child) DeleteOwnedTree(child.FullName);
            else entry.Delete();
        }
        directory.Delete();
    }

    private static async Task<bool> WaitForHealthAsync(string version, string dataDir, TimeSpan timeout)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var json = await client.GetStringAsync("http://127.0.0.1:3788/api/system/health");
                using var document = JsonDocument.Parse(json);
                var root = document.RootElement;
                var reportedDataDir = root.GetProperty("dataDir").GetString();
                if (root.GetProperty("product").GetString() == "stella-director" &&
                    root.GetProperty("version").GetString() == version &&
                    !string.IsNullOrWhiteSpace(reportedDataDir) &&
                    Path.GetFullPath(reportedDataDir).Equals(Path.GetFullPath(dataDir), StringComparison.OrdinalIgnoreCase)) return true;
            }
            catch { }
            await Task.Delay(500);
        }
        return false;
    }

    private static void RegisterInstallation(string installDir, string dataDir, string version, bool desktopShortcut, bool autoStart)
    {
        using (var key = Registry.CurrentUser.CreateSubKey(ProductKey))
        {
            key.SetValue("InstallDir", installDir);
            key.SetValue("DataDir", dataDir);
            key.SetValue("Version", version);
            key.SetValue("ManifestSha256", HashFile(Path.Combine(installDir, "payload-manifest.json")));
            var installId = Convert.ToString(key.GetValue("InstallId"));
            key.SetValue("InstallId", string.IsNullOrWhiteSpace(installId) ? Guid.NewGuid().ToString("D") : installId);
            key.SetValue("AutoStart", autoStart ? 1 : 0, RegistryValueKind.DWord);
        }
        using (var uninstall = Registry.CurrentUser.CreateSubKey(UninstallKey))
        {
            uninstall.SetValue("DisplayName", "星澜赛事导播系统");
            uninstall.SetValue("DisplayVersion", version);
            uninstall.SetValue("Publisher", "星澜游戏幻梦团");
            uninstall.SetValue("InstallLocation", installDir);
            uninstall.SetValue("DisplayIcon", Path.Combine(installDir, "StellaDirector.exe"));
            uninstall.SetValue("UninstallString", $"\"{Path.Combine(installDir, "StellaDirector.exe")}\" --uninstall");
            uninstall.SetValue("QuietUninstallString", $"\"{Path.Combine(installDir, "StellaDirector.exe")}\" --uninstall-keep-data");
            uninstall.SetValue("EstimatedSize", (int)Math.Min(int.MaxValue, DirectorySize(installDir) / 1024), RegistryValueKind.DWord);
            uninstall.SetValue("NoModify", 1, RegistryValueKind.DWord);
            uninstall.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            uninstall.SetValue("SystemComponent", 0, RegistryValueKind.DWord);
        }
        using (var run = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"))
        {
            if (autoStart) run.SetValue("StellaDirector", $"\"{Path.Combine(installDir, "StellaDirector.exe")}\" --background");
            else run.DeleteValue("StellaDirector", false);
        }
        var desktop = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "星澜赛事导播系统.lnk");
        var startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", "星澜赛事导播系统.lnk");
        var uninstallShortcut = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", "卸载星澜赛事导播系统.lnk");
        if (desktopShortcut) CreateShortcut(desktop, installDir);
        else try { File.Delete(desktop); } catch { }
        CreateShortcut(startMenu, installDir);
        CreateShortcut(uninstallShortcut, installDir, "--uninstall");
    }

    private static long DirectorySize(string installDir)
    {
        try { return new DirectoryInfo(installDir).EnumerateFiles("*", SearchOption.AllDirectories).Sum(file => file.Length); }
        catch { return 0; }
    }

    private static void CreateShortcut(string shortcutPath, string installDir, string arguments = "--open")
    {
        Directory.CreateDirectory(Path.GetDirectoryName(shortcutPath)!);
        var escapedShortcut = shortcutPath.Replace("'", "''");
        var executable = Path.Combine(installDir, "StellaDirector.exe").Replace("'", "''");
        var working = installDir.Replace("'", "''");
        var escapedArguments = arguments.Replace("'", "''");
        var script = $"$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{escapedShortcut}');$s.TargetPath='{executable}';$s.Arguments='{escapedArguments}';$s.WorkingDirectory='{working}';$s.IconLocation='{executable},0';$s.Save()";
        using var process = Process.Start(new ProcessStartInfo("powershell.exe", $"-NoProfile -NonInteractive -Command \"{script}\"") { UseShellExecute = false, CreateNoWindow = true });
        process?.WaitForExit(10000);
    }

    private static void TrimBackups(string root, int keep)
    {
        if (!Directory.Exists(root)) return;
        foreach (var directory in new DirectoryInfo(root).GetDirectories().OrderByDescending(item => item.CreationTimeUtc).Skip(keep))
            try { directory.Delete(true); } catch { }
    }
}

internal sealed record InstallProgress(int Percent, string Message);
internal sealed record InstalledProduct(string InstallDir, string Version, bool Registered);
internal sealed record PayloadFile(string Path, long Size, string Sha256);
internal sealed record PayloadManifest(string Product, string Version, string GeneratedAt, List<PayloadFile> Files);
