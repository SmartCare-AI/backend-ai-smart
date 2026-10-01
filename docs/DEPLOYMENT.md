# Deployment Guide — SmartCare AI API

Target: Ubuntu/Debian VPS · domain **artsoraback.tech** · app on port **3050** behind nginx with HTTPS.

## 0. One-time server prerequisites

```bash
# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx postgresql

# PM2 process manager
sudo npm i -g pm2
pm2 startup   # follow the printed instruction so the API survives reboots
```

Create the database and user:

```bash
sudo -u postgres psql -c "CREATE USER smartcare WITH PASSWORD '<strong-password>';"
sudo -u postgres psql -c "CREATE DATABASE smartcare OWNER smartcare;"
```

(Optional, recommended for rate limiting) `sudo apt-get install -y redis-server` and set `REDIS_URL=redis://localhost:6379` in `.env`.

## 1. First deploy

```bash
git clone <repo-url> smartcare-api && cd smartcare-api
cp .env.example .env
nano .env        # set DATABASE_URL, JWT secrets, MAIL_PASSWORD, FIREBASE_*, PORT=3050
npm run deploy   # install → prisma generate → migrate → build → pm2 start
```

## 2. Point the domain

At your DNS provider, create an **A record** for `artsoraback.tech` (host `@`) pointing to the server's IP.

## 3. nginx reverse proxy → port 3050

`sudo nano /etc/nginx/sites-available/artsoraback.tech`:

```nginx
server {
    listen 80;
    server_name artsoraback.tech;

    # File uploads up to 10 MB (matches the API's limit)
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:3050;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/artsoraback.tech /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 4. HTTPS (Let's Encrypt — free, auto-renewing)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d artsoraback.tech --redirect
```

Done — the API is live at:

- **API base:** `https://artsoraback.tech/api/v1`
- **Swagger docs:** `https://artsoraback.tech/docs`
- **Health check:** `https://artsoraback.tech/api/v1/health`
- **Uploaded files:** `https://artsoraback.tech/files/...`

> Because the app sits behind nginx, rate limiting must see the real client IP.
> The `X-Forwarded-For` header is passed above; Express is configured to trust it
> via `trust proxy` in `src/main.ts`.

## 5. Every update after that

```bash
npm run redeploy
```

One command: `git pull` → `npm install` → `prisma generate` → `prisma migrate deploy` → `build` → PM2 restart with fresh env.

Useful PM2 commands: `pm2 logs smartcare-api`, `pm2 status`, `pm2 restart smartcare-api`.

## 6. (Optional) Python ML triage service

Without this step triage answers from the built-in rules engine. To switch on the
trained models (`smartcare-ml/`, see its README):

**One-time prerequisite** — Python 3.11 or newer with the venv module:

```bash
python3 --version                      # Ubuntu 24.04 → 3.12, Debian 12 → 3.11: fine
sudo apt-get install -y python3-venv
```

On an older system (Ubuntu 22.04 ships Python 3.10) install a newer Python
first and tell the script to use it:

```bash
sudo add-apt-repository -y ppa:deadsnakes/ppa
sudo apt-get install -y python3.12 python3.12-venv
PYTHON=python3.12 npm run deploy:ml
```

**First deploy and every update** (from the repository root):

```bash
npm run deploy:ml          # = bash smartcare-ml/deploy.sh
```

The script creates `smartcare-ml/.venv`, installs the five runtime packages,
runs a smoke test (the committed models load and answer correctly) and only
then starts or restarts the `smartcare-ml` PM2 process, waiting until
`/health` answers. If the smoke test fails the running process is left alone.

**Switch the API over** (first time only):

```bash
nano .env                  # AI_SERVICE_URL=http://localhost:8000
pm2 restart smartcare-api --update-env
```

Triage responses now carry `"engine": "ml-service"`; if the ML service is down
they fall back to `"rules-fallback"` automatically. To switch the AI off again,
empty `AI_SERVICE_URL` and restart the API.

After an `npm run redeploy` that changed anything under `smartcare-ml/`, run
`npm run deploy:ml` again.

Check it:

```bash
curl http://127.0.0.1:8000/health                       # {"status":"ok",...}
pm2 status                                              # smartcare-api and smartcare-ml online
pm2 logs smartcare-ml --lines 20
```

The ML service is internal-only: it listens on 127.0.0.1 and needs **no** nginx
change. The trained models are committed in `smartcare-ml/models/`, so nothing is
trained on the server. It uses about 280 MB of RAM (PM2 restarts it above
512 MB) and the install downloads about 80 MB of packages. These steps were
rehearsed on a clean Ubuntu 24.04 (Python 3.12, Node 22, PM2). A different port: `ML_PORT=8010 npm run deploy:ml` (and
the same port in `AI_SERVICE_URL`).
