; -- YTDownloader.iss --
[Setup]
AppName=YT Downloader
AppVersion=1.0
DefaultDirName={pf}\YT Downloader
DefaultGroupName=YT Downloader
OutputDir=.
OutputBaseFilename=YTDownloaderSetup
Compression=lzma
SolidCompression=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &Desktop icon"; GroupDescription: "Additional icons:"; Flags: unchecked

[Files]
; your packed EXE
Source: "YTDownload.exe";                                 DestDir: "{app}"; Flags: ignoreversion
; the local yt-dlp binary
Source: "yt-dlp.exe";                                    DestDir: "{app}"; Flags: ignoreversion
; everything under your ffmpeg build folder
Source: "ffmpeg-6.0-essentials_build\*";                 DestDir: "{app}\ffmpeg-6.0-essentials_build"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Start Menu shortcut
Name: "{group}\YT Downloader";       Filename: "{app}\YTDownload.exe"
; Desktop shortcut (optional)
Name: "{userdesktop}\YT Downloader"; Filename: "{app}\YTDownload.exe"; Tasks: desktopicon

[Run]
; Optionally launch after install
Filename: "{app}\YTDownload.exe"; Description: "Launch YT Downloader"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Clean up desktop shortcut
Type: files; Name: "{userdesktop}\YT Downloader.lnk"
