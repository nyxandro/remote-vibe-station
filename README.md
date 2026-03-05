# Remote Vibe Station

Быстрая установка удаленной dev-среды одной командой:

```bash
curl -fsSL https://raw.githubusercontent.com/nyxandro/remote-vibe-station/master/scripts/bootstrap-runtime.sh | sudo bash -s -- --bot-token "<TELEGRAM_BOT_TOKEN>" --admin-id "<TELEGRAM_ADMIN_ID>" --domain auto --tls-email "<YOUR_EMAIL>"
```

Что делает команда:

- Ставит Docker и системные зависимости.
- Генерирует runtime-конфиг и секреты.
- Настраивает firewall (UFW) и fail2ban.
- Поднимает сервисы через Docker Compose.
- Использует авто-домен формата `<SERVER_IP>.sslip.io`.

Подробная инструкция: `docs/runtime-install.md`.
