$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class ForegroundWindowControl
{
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

    public static bool Maximize()
    {
        bool maximized = false;
        EnumWindows(delegate (IntPtr handle, IntPtr _) {
            if (!IsWindowVisible(handle)) return true;
            StringBuilder title = new StringBuilder(512);
            GetWindowText(handle, title, title.Capacity);
            if (title.ToString().Contains("星澜赛事导播系统")) {
                maximized = ShowWindowAsync(handle, 3) || maximized;
            }
            return true;
        }, IntPtr.Zero);
        if (maximized) return true;
        IntPtr foregroundHandle = GetForegroundWindow();
        return foregroundHandle != IntPtr.Zero && ShowWindowAsync(foregroundHandle, 3);
    }
}
'@

[ordered]@{ maximized = [ForegroundWindowControl]::Maximize() } | ConvertTo-Json -Compress
