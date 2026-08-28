using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class CloudMusicAudio
{
    private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    private enum EDataFlow { eRender, eCapture, eAll }
    private enum ERole { eConsole, eMultimedia, eCommunications }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumerator { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice endpoint);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid interfaceId, int classContext, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
        [PreserveSig] int OpenPropertyStore(int access, out IntPtr properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionManager2
    {
        [PreserveSig] int GetAudioSessionControl(ref Guid sessionId, uint flags, out IntPtr control);
        [PreserveSig] int GetSimpleAudioVolume(ref Guid sessionId, uint flags, out IntPtr volume);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator enumerator);
        [PreserveSig] int RegisterSessionNotification(IntPtr notification);
        [PreserveSig] int UnregisterSessionNotification(IntPtr notification);
        [PreserveSig] int RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)] string sessionId, IntPtr notification);
        [PreserveSig] int UnregisterDuckNotification(IntPtr notification);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, out IAudioSessionControl control);
    }

    [ComImport, Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionControl
    {
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid context);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid context);
        [PreserveSig] int GetGroupingParam(out Guid groupingId);
        [PreserveSig] int SetGroupingParam(ref Guid groupingId, ref Guid context);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr client);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr client);
    }

    [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionControl2
    {
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid context);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid context);
        [PreserveSig] int GetGroupingParam(out Guid groupingId);
        [PreserveSig] int SetGroupingParam(ref Guid groupingId, ref Guid context);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr client);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr client);
        [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetProcessId(out uint processId);
        [PreserveSig] int IsSystemSoundsSession();
        [PreserveSig] int SetDuckingPreference(bool optOut);
    }

    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ISimpleAudioVolume
    {
        [PreserveSig] int SetMasterVolume(float level, ref Guid context);
        [PreserveSig] int GetMasterVolume(out float level);
        [PreserveSig] int SetMute(bool mute, ref Guid context);
        [PreserveSig] int GetMute(out bool mute);
    }

    private static IEnumerable<Tuple<IAudioSessionControl, ISimpleAudioVolume>> Sessions(string processName)
    {
        IMMDeviceEnumerator deviceEnumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        IMMDevice device;
        Marshal.ThrowExceptionForHR(deviceEnumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device));
        Guid managerId = typeof(IAudioSessionManager2).GUID;
        object managerObject;
        Marshal.ThrowExceptionForHR(device.Activate(ref managerId, 23, IntPtr.Zero, out managerObject));
        IAudioSessionManager2 manager = (IAudioSessionManager2)managerObject;
        IAudioSessionEnumerator sessions;
        Marshal.ThrowExceptionForHR(manager.GetSessionEnumerator(out sessions));
        int count;
        Marshal.ThrowExceptionForHR(sessions.GetCount(out count));
        for (int index = 0; index < count; index++)
        {
            IAudioSessionControl control;
            if (sessions.GetSession(index, out control) != 0 || control == null) continue;
            IAudioSessionControl2 control2 = control as IAudioSessionControl2;
            ISimpleAudioVolume volume = control as ISimpleAudioVolume;
            if (control2 == null || volume == null) continue;
            uint processId;
            if (control2.GetProcessId(out processId) != 0 || processId == 0) continue;
            bool matches = false;
            try
            {
                matches = String.Equals(Process.GetProcessById((int)processId).ProcessName, processName, StringComparison.OrdinalIgnoreCase);
            }
            catch { }
            if (matches) yield return Tuple.Create(control, volume);
        }
    }

    private static IntPtr FindPlayerWindow(string processName)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr parameter) {
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            if (processId == 0) return true;
            try
            {
                if (!String.Equals(Process.GetProcessById((int)processId).ProcessName, processName, StringComparison.OrdinalIgnoreCase)) return true;
                var className = new StringBuilder(128);
                GetClassName(window, className, className.Capacity);
                if (className.ToString() != "OrpheusBrowserHost") return true;
                found = window;
                return false;
            }
            catch { return true; }
        }, IntPtr.Zero);
        return found;
    }

    public static string GetTrackTitle(string processName)
    {
        IntPtr window = FindPlayerWindow(processName);
        if (window == IntPtr.Zero) return null;
        var title = new StringBuilder(1024);
        GetWindowText(window, title, title.Capacity);
        return title.ToString();
    }

    public static bool SendMediaCommand(string processName, string command)
    {
        IntPtr window = FindPlayerWindow(processName);
        if (window == IntPtr.Zero) return false;
        int appCommand = command == "next" ? 11 : command == "previous" ? 12 : 14;
        SendMessage(window, 0x0319, window, new IntPtr(appCommand << 16));
        return true;
    }

    private static void SendControlArrow(IntPtr window, int arrowKey)
    {
        PostMessage(window, 0x0100, new IntPtr(0x11), IntPtr.Zero);
        PostMessage(window, 0x0100, new IntPtr(arrowKey), IntPtr.Zero);
        PostMessage(window, 0x0101, new IntPtr(arrowKey), IntPtr.Zero);
        PostMessage(window, 0x0101, new IntPtr(0x11), IntPtr.Zero);
    }

    public static bool SetVolumeByShortcut(string processName, int percent)
    {
        IntPtr window = FindPlayerWindow(processName);
        if (window == IntPtr.Zero) return false;
        for (int index = 0; index < 24; index++) SendControlArrow(window, 0x28);
        int steps = (int)Math.Round(Math.Max(0, Math.Min(100, percent)) / 5.0);
        for (int index = 0; index < steps; index++) SendControlArrow(window, 0x26);
        return true;
    }

    public static bool IsPlaying(string processName)
    {
        foreach (var session in Sessions(processName))
        {
            int state;
            if (session.Item1.GetState(out state) == 0 && state == 1) return true;
        }
        return false;
    }

    public static int GetVolume(string processName)
    {
        foreach (var session in Sessions(processName))
        {
            float level;
            if (session.Item2.GetMasterVolume(out level) == 0) return (int)Math.Round(level * 100);
        }
        return -1;
    }

    public static bool SetVolume(string processName, int percent)
    {
        float level = Math.Max(0, Math.Min(100, percent)) / 100f;
        bool changed = false;
        Guid context = Guid.Empty;
        foreach (var session in Sessions(processName))
        {
            if (session.Item2.SetMasterVolume(level, ref context) == 0) changed = true;
        }
        return changed;
    }
}
