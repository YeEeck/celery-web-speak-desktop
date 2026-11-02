#ifndef AppVersion
  #define AppVersion "0.1.2"
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
Name: "chinesesimplified"; MessagesFile: "languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Celery Web Speak"; Filename: "{app}\Celery Web Speak.exe"
Name: "{autodesktop}\Celery Web Speak"; Filename: "{app}\Celery Web Speak.exe"; Tasks: desktopicon

[Run]
Filename: "ie4uinit.exe"; Parameters: "-show"; Flags: runhidden; Description: "刷新图标缓存"
Filename: "{app}\Celery Web Speak.exe"; Description: "{cm:LaunchProgram,Celery Web Speak}"; Flags: nowait postinstall skipifsilent

[Code]
// 启动条目由应用在运行时创建，安装器绝不创建。Inno Setup 脚本无法 import TypeScript，
// 这里的值名必须与 src/main/startup-entry.ts 的 STARTUP_ENTRY_NAME 保持一致；
// tests/unit/installer.test.ts 会断言两处是同一个字符串。
const
  StartupEntryName = 'Celery Web Speak';
  StartupRunKey = 'Software\Microsoft\Windows\CurrentVersion\Run';

// 卸载时按与运行时相同的值名删除当前用户的启动值。
// 先 RegValueExists 再 RegDeleteValue：值不存在时静默跳过，不提示、不报错。
procedure RemoveStartupEntry;
begin
  if RegValueExists(HKEY_CURRENT_USER, StartupRunKey, StartupEntryName) then
    RegDeleteValue(HKEY_CURRENT_USER, StartupRunKey, StartupEntryName);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    // 启动值清理与用户数据清理互不依赖：用户选择“否”也要清理。
    RemoveStartupEntry;
    if MsgBox('是否同时删除服务器地址、登录状态和本地设置？', mbConfirmation, MB_YESNO) = IDYES then
      DelTree(ExpandConstant('{userappdata}\Celery Web Speak'), True, True, True);
  end;
end;
