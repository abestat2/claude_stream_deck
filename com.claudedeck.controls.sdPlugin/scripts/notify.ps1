# Plays a sound and shows a Windows notification.
#
# Input is read from environment variables:
#   CLAUDE_DECK_TITLE   notification title
#   CLAUDE_DECK_BODY    notification text
#   CLAUDE_DECK_SOUND   "1" to play the system exclamation sound
#   CLAUDE_DECK_TOAST   "1" to show a notification

$ErrorActionPreference = 'Stop'

if ($env:CLAUDE_DECK_SOUND -eq '1') {
    [System.Media.SystemSounds]::Exclamation.Play()
    Start-Sleep -Milliseconds 800
}

if ($env:CLAUDE_DECK_TOAST -eq '1') {
    [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]

    $title = [System.Security.SecurityElement]::Escape($env:CLAUDE_DECK_TITLE)
    $body = [System.Security.SecurityElement]::Escape($env:CLAUDE_DECK_BODY)

    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$title</text><text>$body</text></binding></visual></toast>")

    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
}
