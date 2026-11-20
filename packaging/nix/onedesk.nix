# Community NixOS packaging (onedesk#1858): wrap the upstream AppImage with
# appimageTools instead of rebuilding the Electron/Rust source tree under nix.
# The AppImage is self-contained, so this runs the same bits the README ships.
# The desktop entry and icons come from this repo (apps/shell/build/icons, the
# same files electron-builder packages), not from the AppImage's internals.
#
# Known caveat: the nix store is mounted nosuid, so Chromium aborts when its
# setuid sandbox helper (chrome-sandbox, shipped inside the AppImage) is found
# but not setuid. If the app fails to start with that message, launch it once
# with `onedesk --no-sandbox` (the flag passes straight through the wrapper).
# The Flatpak packaging keeps the real sandbox via Zypak instead.
{
  lib,
  appimageTools,
  fetchurl,
}:

let
  version = "0.11.0";
  src = fetchurl {
    url = "https://onedesk.jiulu.ltd/releases/download/v${version}/OneDesk-${version}.AppImage";
    hash = "sha256-iYKCjYfFFe4YzfezxahhCbwMl+FvkBkogZGSnhxOQWw=";
  };
in
appimageTools.wrapType2 {
  pname = "onedesk";
  inherit version src;

  # the AppImage bundles most Electron deps; these two are the ones Electron
  # dlopens from the host (keyring storage for saved API keys, TLS certs)
  extraPkgs =
    pkgs: with pkgs; [
      libsecret
      nss
    ];

  extraInstallCommands = ''
    install -Dm644 ${../../apps/shell/build/icons/16x16.png} $out/share/icons/hicolor/16x16/apps/onedesk.png
    install -Dm644 ${../../apps/shell/build/icons/32x32.png} $out/share/icons/hicolor/32x32/apps/onedesk.png
    install -Dm644 ${../../apps/shell/build/icons/48x48.png} $out/share/icons/hicolor/48x48/apps/onedesk.png
    install -Dm644 ${../../apps/shell/build/icons/64x64.png} $out/share/icons/hicolor/64x64/apps/onedesk.png
    install -Dm644 ${../../apps/shell/build/icons/128x128.png} $out/share/icons/hicolor/128x128/apps/onedesk.png
    install -Dm644 ${../../apps/shell/build/icons/256x256.png} $out/share/icons/hicolor/256x256/apps/onedesk.png
    install -Dm644 ${../../apps/shell/build/icons/512x512.png} $out/share/icons/hicolor/512x512/apps/onedesk.png
    install -Dm644 ${../../apps/shell/build/icons/1024x1024.png} $out/share/icons/hicolor/1024x1024/apps/onedesk.png
    mkdir -p $out/share/applications
    cat > $out/share/applications/onedesk.desktop <<EOF
    [Desktop Entry]
    Name=OneDesk
    Exec=onedesk %U
    Terminal=false
    Type=Application
    Icon=onedesk
    StartupWMClass=onedesk
    Comment=Unified OneDesk shell: one app hosting the docs and sheets modules behind a home/launcher window
    MimeType=application/vnd.openxmlformats-officedocument.wordprocessingml.document;application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;application/vnd.ms-excel.sheet.macroEnabled.12;application/vnd.openxmlformats-officedocument.presentationml.presentation;application/vnd.ms-excel;text/csv;text/tab-separated-values;application/pdf;text/markdown;text/html;
    Categories=Office;
    EOF
  '';

  meta = with lib; {
    description = "AI-native office suite: Word, Excel, PowerPoint, PDF and Markdown in one local app";
    homepage = "https://onedesk.jiulu.ltd";
    license = licenses.asl20;
    mainProgram = "onedesk";
    platforms = [ "x86_64-linux" ];
    sourceProvenance = with sourceTypes; [ binaryNativeCode ];
  };
}
