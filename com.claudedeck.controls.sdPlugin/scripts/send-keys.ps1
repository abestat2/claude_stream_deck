# Long-running keyboard input helper.
#
# Reads one JSON command per line from stdin and sends the described input to the
# foreground window using the Win32 SendInput API.
#
# Command format:
#   {"id": 1, "delayMs": 40, "steps": [
#     {"type": "text", "value": "yes"},
#     {"type": "key", "vk": 13, "extended": false, "modifiers": [16]}
#   ]}
#
# For each command, one line is written to stdout:
#   ok <id>
#   err <id> <message>

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class KeySender
{
    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_UNICODE = 0x0004;

    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT
    {
        public uint type;
        public InputUnion u;
    }

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    static INPUT Key(ushort vk, ushort scan, uint flags)
    {
        INPUT input = new INPUT();
        input.type = INPUT_KEYBOARD;
        input.u.ki.wVk = vk;
        input.u.ki.wScan = scan;
        input.u.ki.dwFlags = flags;
        return input;
    }

    static void Send(List<INPUT> inputs)
    {
        if (inputs.Count == 0) return;
        INPUT[] arr = inputs.ToArray();
        uint sent = SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT)));
        if (sent != arr.Length)
        {
            throw new Exception("SendInput accepted " + sent + " of " + arr.Length + " events (error " + Marshal.GetLastWin32Error() + ")");
        }
    }

    public static void Text(string value)
    {
        List<INPUT> inputs = new List<INPUT>();
        foreach (char c in value)
        {
            inputs.Add(Key(0, c, KEYEVENTF_UNICODE));
            inputs.Add(Key(0, c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
        }
        Send(inputs);
    }

    public static void Press(ushort vk, bool extended, ushort[] modifiers)
    {
        List<INPUT> inputs = new List<INPUT>();
        foreach (ushort mod in modifiers)
        {
            uint modFlags = mod == 0x5B ? KEYEVENTF_EXTENDEDKEY : 0;
            inputs.Add(Key(mod, 0, modFlags));
        }
        uint flags = extended ? KEYEVENTF_EXTENDEDKEY : 0;
        inputs.Add(Key(vk, 0, flags));
        inputs.Add(Key(vk, 0, flags | KEYEVENTF_KEYUP));
        for (int i = modifiers.Length - 1; i >= 0; i--)
        {
            uint modFlags = modifiers[i] == 0x5B ? KEYEVENTF_EXTENDEDKEY : 0;
            inputs.Add(Key(modifiers[i], 0, modFlags | KEYEVENTF_KEYUP));
        }
        Send(inputs);
    }
}
'@

# When CLAUDE_DECK_DRY_RUN is "1", nothing is sent. Each action is written to standard output instead,
# as "text <json string>" or "key <virtual key> <modifiers joined by +>", and CLAUDE_DECK_CLIPBOARD,
# when set, replaces the clipboard contents.
$dryRun = $env:CLAUDE_DECK_DRY_RUN -eq '1'

# Largest clipboard text that is typed.
$maxClipboardChars = 10000

function Send-Text([string]$value) {
    if ($dryRun) {
        [Console]::Out.WriteLine('text ' + (ConvertTo-Json -InputObject $value -Compress))
    } else {
        [KeySender]::Text($value)
    }
}

function Send-Key([uint16]$vk, [bool]$extended, [uint16[]]$mods) {
    if ($dryRun) {
        [Console]::Out.WriteLine("key $vk $($mods -join '+')")
    } else {
        [KeySender]::Press($vk, $extended, $mods)
    }
}

function Get-ClipboardText {
    if ($dryRun -and $null -ne $env:CLAUDE_DECK_CLIPBOARD) { return $env:CLAUDE_DECK_CLIPBOARD }
    return Get-Clipboard -Raw
}

# Types the clipboard text. Line breaks inside the text are entered as Ctrl+J, which starts a new line
# in the Claude Code prompt without submitting it. Trailing line breaks are dropped and the text is
# cut to $maxClipboardChars characters.
function Send-Clipboard {
    $text = Get-ClipboardText
    if ([string]::IsNullOrEmpty($text)) { return }
    $text = $text.TrimEnd("`r", "`n")
    if ($text.Length -gt $maxClipboardChars) { $text = $text.Substring(0, $maxClipboardChars).TrimEnd("`r", "`n") }
    $lines = $text -split "`r?`n"
    for ($i = 0; $i -lt $lines.Length; $i++) {
        if ($i -gt 0) { Send-Key 74 $false ([uint16[]]@(17)) }
        if ($lines[$i].Length -gt 0) { Send-Text $lines[$i] }
    }
}

[Console]::Out.WriteLine('ready')

while ($null -ne ($line = [Console]::In.ReadLine())) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $id = $null
    try {
        $cmd = $line | ConvertFrom-Json
        $id = $cmd.id
        $delay = [int]$cmd.delayMs
        $first = $true
        foreach ($step in $cmd.steps) {
            if (-not $first -and $delay -gt 0) { Start-Sleep -Milliseconds $delay }
            $first = $false
            if ($step.type -eq 'text') {
                Send-Text ([string]$step.value)
            } elseif ($step.type -eq 'key') {
                $mods = [uint16[]]@($step.modifiers | ForEach-Object { [uint16]$_ })
                Send-Key ([uint16]$step.vk) ([bool]$step.extended) $mods
            } elseif ($step.type -eq 'clipboard') {
                Send-Clipboard
            } else {
                throw "Unknown step type '$($step.type)'"
            }
        }
        [Console]::Out.WriteLine("ok $id")
    } catch {
        $msg = ($_.Exception.Message -replace '[\r\n]+', ' ')
        [Console]::Out.WriteLine("err $id $msg")
    }
}
