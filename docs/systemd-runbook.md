# Pump Bot via systemd (user services)

## Cosa ho implementato

Sono stati configurati due servizi `systemd --user`:

- `pump-sniper.service`
- `pump-report.service`

Unit files:

- `/home/manu/.config/systemd/user/pump-sniper.service`
- `/home/manu/.config/systemd/user/pump-report.service`

Entrambi hanno:

- `Restart=always`
- `RestartSec=3`
- working directory su `/home/manu/pump-amm-sniper`

Il bot usa il build JS stabile:

- `ExecStart=/usr/bin/node /home/manu/pump-amm-sniper/dist/pumpAmmSniper.js`

Il report daemon usa:

- `ExecStart=/usr/bin/node /home/manu/pump-amm-sniper/scripts/paper-report-daemon.js`

## Log

- Bot: `/home/manu/pump-amm-sniper/paper.log`
- Report daemon: `/home/manu/pump-amm-sniper/logs/paper-report-daemon.log`
- Report output: `/home/manu/pump-amm-sniper/logs/paper-report.txt` e `paper-report.json`

## Comandi operativi

Stato:

```bash
systemctl --user status pump-sniper.service
systemctl --user status pump-report.service
```

Start/stop/restart:

```bash
systemctl --user start pump-sniper.service pump-report.service
systemctl --user stop pump-sniper.service pump-report.service
systemctl --user restart pump-sniper.service pump-report.service
```

## Restart post-modifiche importanti (obbligatorio)

Quando cambi logica di trading/controlli/report:

1. Stop servizi:
```bash
systemctl --user stop pump-sniper.service pump-report.service
```

2. Reset log/report:
```bash
truncate -s 0 /home/manu/pump-amm-sniper/paper.log
printf '{}\n' > /home/manu/pump-amm-sniper/logs/paper-report.json
printf '\n' > /home/manu/pump-amm-sniper/logs/paper-report.txt
truncate -s 0 /home/manu/pump-amm-sniper/logs/paper-worker-1.log \
  /home/manu/pump-amm-sniper/logs/paper-worker-2.log \
  /home/manu/pump-amm-sniper/logs/paper-worker-3.log \
  /home/manu/pump-amm-sniper/logs/paper-report-daemon.log
```

Nota:
- se usi piu worker, azzera sempre tutti i file `logs/paper-worker-*.log` presenti prima del restart

3. Start servizi:
```bash
systemctl --user start pump-sniper.service pump-report.service
```

Abilitazione al boot utente:

```bash
systemctl --user enable pump-sniper.service pump-report.service
```

Log live:

```bash
tail -f /home/manu/pump-amm-sniper/paper.log
tail -f /home/manu/pump-amm-sniper/logs/paper-report-daemon.log
```

## Nota importante (persistenza senza login)

Stato attuale:

- `Linger=no` per l'utente `manu`

Con `Linger=no`, i servizi `--user` non restano sempre disponibili se non c'e una sessione utente attiva.
Per tenerli sempre su anche dopo logout/reboot:

```bash
sudo loginctl enable-linger manu
```

Verifica:

```bash
loginctl show-user manu -p Linger
```
