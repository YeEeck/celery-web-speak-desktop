#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\release\win-unpacked"
#endif
#ifndef OutputDir
  #define OutputDir "..\release"
#endif

[Setup]
AppId={{8C685843-0187-4C32-B057-7D9F97CEB33F}
AppName=Celery Web Speak
AppVersion={#AppVersion}
AppPublisher=YeEeck
DefaultDirName={localappdata}\Programs\Celery Web Speak
DefaultGroupName=Celery Web Speak
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=CeleryWebSpeak-Setup-{#AppVersion}-windows-x64
SetupIconFile=icons\icon.ico
UninstallDisplayIcon={app}\Celery Web Speak.exe
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Celery Web Speak"; Filename: "{app}\Celery Web Speak.exe"
Name: "{autodesktop}\Celery Web Speak"; Filename: "{app}\Celery Web Speak.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Celery Web Speak.exe"; Description: "{cm:LaunchProgram,Celery Web Speak}"; Flags: nowait postinstall skipifsilent

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    if MsgBox('是否同时删除服务器地址、登录状态和本地设置？', mbConfirmation, MB_YESNO) = IDYES then
      DelTree(ExpandConstant('{userappdata}\Celery Web Speak'), True, True, True);
  end;
end;
