#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_BIN="$DESKTOP_DIR/src-tauri/target/release/ignit-desktop"
FALLBACK_APPIMAGE="$DESKTOP_DIR/src-tauri/target/release/bundle/appimage/Ignit_0.1.0_amd64.AppImage"

EXEC_PATH="${1:-$DEFAULT_BIN}"
if [[ ! -x "$EXEC_PATH" && -x "$FALLBACK_APPIMAGE" ]]; then
  EXEC_PATH="$FALLBACK_APPIMAGE"
fi

if [[ ! -e "$EXEC_PATH" ]]; then
  echo "No se encontró el binario ni el AppImage de Ignit Desktop. Ejecutá 'cargo tauri build' primero." >&2
  exit 1
fi

ICON_SRC="$DESKTOP_DIR/src-tauri/icons/icon.png"
ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
APPS_DIR="$HOME/.local/share/applications"

mkdir -p "$ICON_DIR" "$APPS_DIR"
cp "$ICON_SRC" "$ICON_DIR/ignit.png"

cat > "$APPS_DIR/ignit.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Ignit
Comment=Visor inmersivo de lectura PDF y biblioteca (modo Vigilia)
Exec=$EXEC_PATH
Icon=$ICON_DIR/ignit.png
Terminal=false
Categories=Education;Literature;Office;
StartupWMClass=ignit-desktop
EOF

chmod +x "$APPS_DIR/ignit.desktop"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
fi

echo "Instalado: $APPS_DIR/ignit.desktop -> $EXEC_PATH"
