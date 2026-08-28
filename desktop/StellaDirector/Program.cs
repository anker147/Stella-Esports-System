using System.Diagnostics;
using System.IO.Pipes;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;

namespace StellaDirector;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Contains("--uninstall") || args.Contains("--uninstall-keep-data") || args.Contains("--uninstall-remove-data"))
        {
            ApplicationConfiguration.Initialize();
            RunUninstall(args.Contains("--uninstall-keep-data") ? DialogResult.No :
                (args.Contains("--uninstall-remove-data") ? DialogResult.Yes : null));
            return;
        }
        using var mutex = new Mutex(true, "Local\\StellaDirector.Tray", out var created);
        if (!created)
        {
            SendExistingInstance(args.Contains("--open") ? "open" : "show");
            return;
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new TrayContext(args));
    }

    private static void SendExistingInstance(string command)
    {
        try
        {
            using var pipe = new NamedPipeClientStream(".", "StellaDirector.Control", PipeDirection.InOut);
            pipe.Connect(1500);
            using var writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true) { AutoFlush = true };
            writer.WriteLine(command);
        }
        catch { }
    }

    private static void RunUninstall(DialogResult? requestedChoice = null)
    {
        var choice = requestedChoice ?? MessageBox.Show(
            "是否同时删除本机的 BP 存档、素材库索引、配置和运行日志？\n\n选择“否”将只删除程序并保留用户数据；外部赛事素材和 OBS 配置文件始终不会被删除。",
            "卸载星澜赛事导播系统",
            MessageBoxButtons.YesNoCancel,
            MessageBoxIcon.Warning,
            MessageBoxDefaultButton.Button2);
        if (choice == DialogResult.Cancel) return;

        var installDir = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        string? dataDir = null;
        string? manifestSha256 = null;
        using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Stella\DirectorSystem"))
        {
            dataDir = Convert.ToString(key?.GetValue("DataDir"));
            manifestSha256 = Convert.ToString(key?.GetValue("ManifestSha256"));
        }
        List<string> managedFiles;
        try { managedFiles = ReadManagedProgramFiles(installDir, manifestSha256); }
        catch (Exception error)
        {
            MessageBox.Show($"无法验证程序文件清单，卸载已停止。\n\n{error.Message}", "卸载安全检查失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        var expectedDataDir = Path.Combine(installDir, "user-data", "data");
        var deleteData = choice == DialogResult.Yes;
        if (deleteData && !Path.GetFullPath(dataDir ?? "").Equals(Path.GetFullPath(expectedDataDir), StringComparison.OrdinalIgnoreCase))
        {
            MessageBox.Show("用户数据目录不在当前安装目录的受控位置，卸载程序拒绝删除数据。", "卸载安全检查失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        StopInstalledProcesses(installDir, expectedDataDir);

        var script = Path.Combine(Directory.GetParent(installDir)?.FullName ?? Path.GetTempPath(), $".stella-uninstall-{Guid.NewGuid():N}.ps1");
        var directories = managedFiles.Select(Path.GetDirectoryName).Where(path => !string.IsNullOrWhiteSpace(path))
            .Append(installDir).Distinct(StringComparer.OrdinalIgnoreCase).OrderByDescending(path => path!.Length).ToList();
        var fileList = PowerShellArray(managedFiles);
        var directoryList = PowerShellArray(directories!);
        var dataRoot = Path.Combine(installDir, "user-data").Replace("'", "''");
        var content = $"$files=@({fileList})\r\n$directories=@({directoryList})\r\n" +
            $"$dataRoot={(deleteData ? $"'{dataRoot}'" : "$null")}\r\n" +
            "function Remove-SafeTree([string]$target){if(!(Test-Path -LiteralPath $target)){return};" +
            "$item=Get-Item -LiteralPath $target -Force;" +
            "if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){Remove-Item -LiteralPath $target -Force;return};" +
            "if(!$item.PSIsContainer){Remove-Item -LiteralPath $target -Force;return};" +
            "Get-ChildItem -LiteralPath $target -Force | ForEach-Object {Remove-SafeTree $_.FullName};" +
            "Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue}\r\n" +
            "Start-Sleep -Seconds 2\r\n" +
            "foreach($file in $files){Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue}\r\n" +
            "if($dataRoot){Remove-SafeTree $dataRoot}\r\n" +
            "foreach($directory in $directories){if((Test-Path -LiteralPath $directory) -and !(Get-ChildItem -LiteralPath $directory -Force | Select-Object -First 1)){Remove-Item -LiteralPath $directory -Force -ErrorAction SilentlyContinue}}\r\n" +
            "Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue\r\n";
        File.WriteAllText(script, content, new UTF8Encoding(true));
        Process.Start(new ProcessStartInfo("powershell.exe", $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{script}\"")
        {
            UseShellExecute = false,
            CreateNoWindow = true
        });

        try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Stella\DirectorSystem", false); } catch { }
        try
        {
            using var run = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
            run.DeleteValue("StellaDirector", false);
        }
        catch { }
        try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\StellaDirector", false); } catch { }
        DeleteShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "星澜赛事导播系统.lnk"));
        DeleteShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", "星澜赛事导播系统.lnk"));
        DeleteShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", "卸载星澜赛事导播系统.lnk"));
    }

    private static List<string> ReadManagedProgramFiles(string installDir, string? expectedSha256)
    {
        var manifestPath = Path.Combine(installDir, "payload-manifest.json");
        if (string.IsNullOrWhiteSpace(expectedSha256)) throw new InvalidDataException("缺少安装清单校验值");
        using (var stream = File.OpenRead(manifestPath))
        {
            var actual = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
            if (!actual.Equals(expectedSha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("安装清单已被修改");
        }
        using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
        var root = document.RootElement;
        if (Property(root, "product").GetString() != "stella-director") throw new InvalidDataException("产品标识无效");
        var files = new List<string>();
        foreach (var entry in Property(root, "files").EnumerateArray())
        {
            var relative = Property(entry, "path").GetString() ?? throw new InvalidDataException("清单文件路径无效");
            files.Add(SafeManagedPath(installDir, relative));
        }
        files.Add(manifestPath);
        return files.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    private static string SafeManagedPath(string installDir, string relative)
    {
        if (Path.IsPathRooted(relative) || relative.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).Contains(".."))
            throw new InvalidDataException($"清单包含不安全路径：{relative}");
        var root = Path.GetFullPath(installDir).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var result = Path.GetFullPath(Path.Combine(root, relative));
        if (!result.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException($"清单路径越界：{relative}");
        return result;
    }

    private static JsonElement Property(JsonElement element, string name)
    {
        foreach (var property in element.EnumerateObject())
            if (property.Name.Equals(name, StringComparison.OrdinalIgnoreCase)) return property.Value;
        throw new InvalidDataException($"清单缺少字段：{name}");
    }

    private static string PowerShellArray(IEnumerable<string> paths) => string.Join(",", paths.Select(path => $"'{path.Replace("'", "''")}'"));

    private static void StopInstalledProcesses(string installDir, string dataDir)
    {
        var expectedNode = Path.GetFullPath(Path.Combine(installDir, "runtime", "node.exe"));
        SendExistingInstance("exit-for-update");
        var expectedTray = Path.GetFullPath(Path.Combine(installDir, "StellaDirector.exe"));
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (DateTime.UtcNow < deadline)
        {
            var running = Process.GetProcessesByName("StellaDirector").Any(process =>
            {
                using (process)
                {
                    try { return process.Id != Environment.ProcessId && Path.GetFullPath(process.MainModule?.FileName ?? "").Equals(expectedTray, StringComparison.OrdinalIgnoreCase); }
                    catch { return false; }
                }
            });
            if (!running) break;
            Thread.Sleep(200);
        }
        foreach (var process in Process.GetProcessesByName("StellaDirector"))
        {
            using (process)
            {
                try
                {
                    if (process.Id != Environment.ProcessId && Path.GetFullPath(process.MainModule?.FileName ?? "").Equals(expectedTray, StringComparison.OrdinalIgnoreCase))
                    {
                        process.Kill(true);
                        process.WaitForExit(5000);
                    }
                }
                catch { }
            }
        }

        foreach (var backend in Process.GetProcessesByName("node"))
        {
            using (backend)
            {
                try
                {
                    if (Path.GetFullPath(backend.MainModule?.FileName ?? "").Equals(expectedNode, StringComparison.OrdinalIgnoreCase))
                    {
                        backend.Kill(true);
                        backend.WaitForExit(5000);
                    }
                }
                catch { }
            }
        }
        try { File.Delete(Path.Combine(dataDir, "backend.pid")); } catch { }
    }

    private static void DeleteShortcut(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }
}

internal sealed class TrayContext : ApplicationContext
{
    private const string ProductKey = @"Software\Stella\DirectorSystem";
    private const string ControlPipe = "StellaDirector.Control";
    private readonly string _installDir = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    private readonly string _dataRoot;
    private readonly string _logsRoot;
    private readonly string _token;
    private readonly NotifyIcon _notifyIcon;
    private readonly ToolStripMenuItem _statusItem;
    private readonly ToolStripMenuItem _startItem;
    private readonly ToolStripMenuItem _stopItem;
    private readonly ToolStripMenuItem _restartItem;
    private readonly ToolStripMenuItem _autoStartItem;
    private readonly System.Windows.Forms.Timer _healthTimer;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(2) };
    private readonly CancellationTokenSource _lifetime = new();
    private readonly SynchronizationContext _ui;
    private Process? _backend;
    private bool _intentionalStop;
    private bool _healthCheckRunning;
    private int _restartAttempts;
    private string _lastState = "starting";

    public TrayContext(string[] args)
    {
        _ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        using var productKey = Registry.CurrentUser.CreateSubKey(ProductKey);
        _dataRoot = Path.Combine(_installDir, "user-data", "data");
        productKey.SetValue("InstallDir", _installDir);
        productKey.SetValue("DataDir", _dataRoot);
        Directory.CreateDirectory(_dataRoot);
        _logsRoot = Path.Combine(Path.GetDirectoryName(_dataRoot)!, "logs");
        Directory.CreateDirectory(_logsRoot);
        _token = LoadOrCreateToken(Path.Combine(Path.GetDirectoryName(_dataRoot)!, "config", "control.token"));

        var menu = new ContextMenuStrip();
        var openItem = new ToolStripMenuItem("打开星澜赛事导播系统", null, async (_, _) => await OpenConsoleAsync());
        openItem.Font = new Font(openItem.Font, FontStyle.Bold);
        _statusItem = new ToolStripMenuItem("后台状态：正在检查") { Enabled = false };
        _startItem = new ToolStripMenuItem("启动后台", null, async (_, _) => await StartBackendAsync());
        _stopItem = new ToolStripMenuItem("停止后台", null, async (_, _) => await StopBackendAsync());
        _restartItem = new ToolStripMenuItem("重启后台", null, async (_, _) => await RestartBackendAsync());
        var logsItem = new ToolStripMenuItem("查看运行日志", null, (_, _) => OpenPath(_logsRoot));
        var installItem = new ToolStripMenuItem("打开安装目录", null, (_, _) => OpenPath(_installDir));
        _autoStartItem = new ToolStripMenuItem("开机自动启动", null, (_, _) => ToggleAutoStart()) { Checked = AutoStartEnabled() };
        var updateItem = new ToolStripMenuItem("运行安装或更新包...", null, (_, _) => SelectUpdatePackage());
        var uninstallItem = new ToolStripMenuItem("卸载星澜赛事导播系统...", null, async (_, _) => await BeginUninstallAsync());
        var versionItem = new ToolStripMenuItem($"当前版本：{Application.ProductVersion}") { Enabled = false };
        var exitItem = new ToolStripMenuItem("退出", null, async (_, _) => await ExitAsync());
        menu.Items.AddRange([
            openItem, new ToolStripSeparator(), _statusItem, _startItem, _stopItem, _restartItem,
            new ToolStripSeparator(), logsItem, installItem, _autoStartItem, updateItem, uninstallItem,
            new ToolStripSeparator(), versionItem, exitItem
        ]);

        _notifyIcon = new NotifyIcon
        {
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application,
            Text = "星澜赛事导播系统",
            ContextMenuStrip = menu,
            Visible = true
        };
        _notifyIcon.DoubleClick += async (_, _) => await OpenConsoleAsync();

        _healthTimer = new System.Windows.Forms.Timer { Interval = 2000 };
        _healthTimer.Tick += async (_, _) => await CheckHealthAsync();
        _healthTimer.Start();
        _ = RunPipeServerAsync(_lifetime.Token);
        _ = StartBackendAsync();
        if (args.Contains("--open")) _ = OpenWhenReadyAsync();
    }

    private static string LoadOrCreateToken(string filePath)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);
        if (File.Exists(filePath)) return File.ReadAllText(filePath).Trim();
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        File.WriteAllText(filePath, token, new UTF8Encoding(false));
        return token;
    }

    private async Task<HealthInfo?> GetHealthAsync()
    {
        try
        {
            var health = await _http.GetFromJsonAsync<HealthInfo>("http://127.0.0.1:3788/api/system/health");
            return health?.Product == "stella-director" &&
                Path.GetFullPath(health.DataDir).Equals(Path.GetFullPath(_dataRoot), StringComparison.OrdinalIgnoreCase) ? health : null;
        }
        catch { return null; }
    }

    private async Task CheckHealthAsync()
    {
        if (_healthCheckRunning) return;
        _healthCheckRunning = true;
        try
        {
            var health = await GetHealthAsync();
            if (health is not null)
            {
                _restartAttempts = 0;
                SetState("running", $"后台状态：运行正常（{health.Version}）");
            }
            else if (_backend is { HasExited: false })
            {
                SetState("starting", "后台状态：正在启动");
            }
            else
            {
                SetState("stopped", "后台状态：已停止");
            }
        }
        finally { _healthCheckRunning = false; }
    }

    private void SetState(string state, string text)
    {
        _statusItem.Text = text;
        _startItem.Enabled = state is "stopped" or "error";
        _stopItem.Enabled = state is "running" or "starting";
        _restartItem.Enabled = state is "running" or "error";
        if (_lastState == state) return;
        _lastState = state;
        _notifyIcon.Text = state == "running" ? "星澜赛事导播系统 - 运行正常" : "星澜赛事导播系统 - 后台未运行";
    }

    private async Task StartBackendAsync()
    {
        if (await GetHealthAsync() is not null)
        {
            SetState("running", "后台状态：运行正常");
            return;
        }
        if (_backend is { HasExited: false }) return;

        var node = Path.Combine(_installDir, "runtime", "node.exe");
        var server = Path.Combine(_installDir, "server", "server.js");
        if (!File.Exists(node) || !File.Exists(server))
        {
            SetState("error", "后台状态：程序文件缺失");
            ShowError("内置 Node.js 或后端文件缺失，请运行安装包修复。", "启动失败");
            return;
        }

        _intentionalStop = false;
        SetState("starting", "后台状态：正在启动");
        var startInfo = new ProcessStartInfo(node, "server/server.js")
        {
            WorkingDirectory = _installDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };
        startInfo.Environment["STELLA_DATA_DIR"] = _dataRoot;
        startInfo.Environment["STELLA_DEFAULTS_DIR"] = Path.Combine(_installDir, "defaults", "data");
        startInfo.Environment["STELLA_CONTROL_TOKEN"] = _token;
        startInfo.Environment["PORT"] = "3788";
        startInfo.Environment["COUNTDOWN_URL"] = "http://127.0.0.1:3788/hub/countdown";
        _backend = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        _backend.OutputDataReceived += (_, e) => AppendLog("server-output.log", e.Data);
        _backend.ErrorDataReceived += (_, e) => AppendLog("server-error.log", e.Data);
        _backend.Exited += (_, _) => _ui.Post(async _ => await BackendExitedAsync(), null);
        try
        {
            _backend.Start();
            _backend.BeginOutputReadLine();
            _backend.BeginErrorReadLine();
            File.WriteAllText(Path.Combine(_dataRoot, "backend.pid"), _backend.Id.ToString());
        }
        catch (Exception ex)
        {
            SetState("error", "后台状态：启动失败");
            AppendLog("server-error.log", ex.ToString());
            ShowError(ex.Message, "后台启动失败");
        }
    }

    private async Task BackendExitedAsync()
    {
        try { File.Delete(Path.Combine(_dataRoot, "backend.pid")); } catch { }
        if (_intentionalStop || _lifetime.IsCancellationRequested)
        {
            SetState("stopped", "后台状态：已停止");
            return;
        }
        if (++_restartAttempts <= 3)
        {
            SetState("starting", $"后台状态：异常退出，正在重启（{_restartAttempts}/3）");
            await Task.Delay(1000);
            await StartBackendAsync();
            return;
        }
        SetState("error", "后台状态：连续启动失败");
        _notifyIcon.ShowBalloonTip(5000, "星澜赛事导播系统", "后台连续启动失败，请查看运行日志。", ToolTipIcon.Error);
    }

    private void AppendLog(string name, string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        try { File.AppendAllText(Path.Combine(_logsRoot, name), $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {line}{Environment.NewLine}"); }
        catch { }
    }

    private async Task StopBackendAsync()
    {
        _intentionalStop = true;
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "http://127.0.0.1:3788/api/system/shutdown");
            request.Headers.Add("X-Stella-Token", _token);
            await _http.SendAsync(request);
        }
        catch { }
        if (_backend is { HasExited: false })
        {
            if (!_backend.WaitForExit(4000))
            {
                try { _backend.Kill(true); } catch { }
            }
        }
        SetState("stopped", "后台状态：已停止");
    }

    private async Task RestartBackendAsync()
    {
        await StopBackendAsync();
        _restartAttempts = 0;
        await StartBackendAsync();
    }

    private async Task OpenWhenReadyAsync()
    {
        for (var i = 0; i < 30; i++)
        {
            if (await GetHealthAsync() is not null)
            {
                OpenUrl("http://127.0.0.1:3788/control.html");
                return;
            }
            await Task.Delay(500);
        }
        ShowError("后台未能在 15 秒内启动，请从托盘菜单查看运行日志。", "无法打开控制台");
    }

    private async Task OpenConsoleAsync()
    {
        await StartBackendAsync();
        await OpenWhenReadyAsync();
    }

    private static void OpenUrl(string url) => Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    private static void OpenPath(string path) => Process.Start(new ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute = true });

    private bool AutoStartEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
        return key?.GetValue("StellaDirector") is not null;
    }

    private void ToggleAutoStart()
    {
        using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
        if (_autoStartItem.Checked)
        {
            key.DeleteValue("StellaDirector", false);
            _autoStartItem.Checked = false;
        }
        else
        {
            key.SetValue("StellaDirector", $"\"{Application.ExecutablePath}\" --background");
            _autoStartItem.Checked = true;
        }
        using var productKey = Registry.CurrentUser.CreateSubKey(ProductKey);
        productKey.SetValue("AutoStart", _autoStartItem.Checked ? 1 : 0, RegistryValueKind.DWord);
    }

    private void SelectUpdatePackage()
    {
        using var dialog = new OpenFileDialog { Filter = "星澜安装或更新包 (*.exe)|*.exe", Title = "选择安装或更新包" };
        if (dialog.ShowDialog() != DialogResult.OK) return;
        Process.Start(new ProcessStartInfo(dialog.FileName) { UseShellExecute = true });
    }

    private async Task BeginUninstallAsync()
    {
        await StopBackendAsync();
        _notifyIcon.Visible = false;
        _lifetime.Cancel();
        Process.Start(new ProcessStartInfo(Application.ExecutablePath, "--uninstall")
        {
            UseShellExecute = true,
            WorkingDirectory = _installDir
        });
        ExitThread();
    }

    private async Task RunPipeServerAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await using var pipe = new NamedPipeServerStream(ControlPipe, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
                await pipe.WaitForConnectionAsync(cancellationToken);
                using var reader = new StreamReader(pipe, Encoding.UTF8, leaveOpen: true);
                var command = await reader.ReadLineAsync(cancellationToken);
                _ui.Post(async _ =>
                {
                    if (command == "open") await OpenConsoleAsync();
                    else if (command == "start") await StartBackendAsync();
                    else if (command == "stop") await StopBackendAsync();
                    else if (command == "restart") await RestartBackendAsync();
                    else if (command == "exit-for-update") await ExitForUpdateAsync();
                }, null);
            }
            catch (OperationCanceledException) { break; }
            catch { await Task.Delay(250, cancellationToken); }
        }
    }

    private async Task ExitForUpdateAsync()
    {
        await StopBackendAsync();
        _notifyIcon.Visible = false;
        _lifetime.Cancel();
        ExitThread();
    }

    private async Task ExitAsync()
    {
        await StopBackendAsync();
        _notifyIcon.Visible = false;
        _lifetime.Cancel();
        ExitThread();
    }

    private static void ShowError(string message, string title) => MessageBox.Show(message, title, MessageBoxButtons.OK, MessageBoxIcon.Error);

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _healthTimer.Dispose();
            _notifyIcon.Dispose();
            _http.Dispose();
            _lifetime.Dispose();
            _backend?.Dispose();
        }
        base.Dispose(disposing);
    }
}

internal sealed record HealthInfo(string Product, string Version, string Status, int Pid, string StartedAt, string DataDir);
