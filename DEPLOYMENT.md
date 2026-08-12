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
