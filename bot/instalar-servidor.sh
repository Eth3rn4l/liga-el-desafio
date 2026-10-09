#!/usr/bin/env bash
# Instala el bot de la liga en un servidor Ubuntu (Oracle Cloud u otro VPS).
# Uso:  bash instalar-servidor.sh
set -e
cd "$(dirname "$0")"

echo "== 1/5 Actualizando el sistema"
sudo apt-get update -y
sudo apt-get install -y curl git fonts-noto-color-emoji

echo "== 2/5 Memoria de respaldo (swap) si el servidor tiene poca RAM"
RAM=$(free -m | awk '/Mem:/{print $2}')
if [ "$RAM" -lt 3000 ] && ! sudo swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "== 3/5 Node.js"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

echo "== 4/5 Navegador Chromium"
if [ ! -x /snap/bin/chromium ] && ! command -v chromium >/dev/null; then
  sudo snap install chromium || sudo apt-get install -y chromium-browser || sudo apt-get install -y chromium
fi
CHROME=$( [ -x /snap/bin/chromium ] && echo /snap/bin/chromium || command -v chromium || command -v chromium-browser )
echo "Chromium: $CHROME"

echo "== 5/5 Bot"
PUPPETEER_SKIP_DOWNLOAD=1 npm install --omit=dev
sudo npm install -g pm2
[ -f config.json ] || cp config.ejemplo.json config.json
read -r -p "Número de WhatsApp del bot con código de país, solo dígitos (ej. 56912345678): " NUM
node -e '
  const fs = require("fs"), c = JSON.parse(fs.readFileSync("config.json", "utf8"));
  c.chromePath = process.argv[1]; if (process.argv[2]) c.numeroBot = process.argv[2].replace(/\D/g, "");
  fs.writeFileSync("config.json", JSON.stringify(c, null, 2));' "$CHROME" "$NUM"

echo
echo "Listo. Siguiente paso: vincular WhatsApp y ver los grupos con:"
echo "   node bot.js --grupos"
