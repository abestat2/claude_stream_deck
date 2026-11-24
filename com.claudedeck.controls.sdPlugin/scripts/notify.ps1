# Plays a sound and shows a Windows notification.
#
# Input is read from environment variables:
#   CLAUDE_DECK_TITLE    notification title
#   CLAUDE_DECK_BODY     notification text
#   CLAUDE_DECK_SOUND    "1" to play the system exclamation sound
#   CLAUDE_DECK_TOAST    "1" to show a notification
#   CLAUDE_DECK_DRY_RUN  "1" to print what would happen instead of doing it: a line "sound" and a line
#                        "toast <notification XML>"

$ErrorActionPreference = 'Stop'

$dryRun = $env:CLAUDE_DECK_DRY_RUN -eq '1'

if ($env:CLAUDE_DECK_SOUND -eq '1') {
    if ($dryRun) {
        [Console]::Out.WriteLine('sound')
    } else {
        [System.Media.SystemSounds]::Exclamation.Play()
        Start-Sleep -Milliseconds 800
    }
}

if ($env:CLAUDE_DECK_TOAST -eq '1') {
    $title = [System.Security.SecurityElement]::Escape($env:CLAUDE_DECK_TITLE)
    $body = [System.Security.SecurityElement]::Escape($env:CLAUDE_DECK_BODY)
    $xmlText = "<toast><visual><binding template='ToastGeneric'><text>$title</text><text>$body</text></binding></visual></toast>"

    if ($dryRun) {
        [Console]::Out.WriteLine("toast $xmlText")
    } else {
        [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
        [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]

        $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
        $xml.LoadXml($xmlText)

        $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
        $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
    }
}
