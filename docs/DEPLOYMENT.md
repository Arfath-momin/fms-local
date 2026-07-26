# Putting FMS online — a step-by-step guide

Written for someone who has never deployed to a server before. Every command is
meant to be copy-pasted in order. Where a command needs something specific to
you, it is written in `ANGLE_BRACKETS`.

Budget about **two hours** for the first run.

---

## Read this first

### Accounts exist only where you make them

There is no self-signup. You create the **first administrator** from the command
line (Step 11). After that, everything is done in the app: that admin adds
users, changes roles, resets passwords and deactivates people from the **Users**
screen.

**Never run `db:seed` on production.** It creates accounts whose passwords are
published in this repository, and it deletes all transactional data first. It is
a development tool only.

### Roles

| Role | Can do |
|---|---|
| **Admin** | Everything. The only role that can change a voucher after it is saved, and the only one who can manage users. |
| **Accountant** | Enters purchases, sales, expenses and delivery notes, and manages parties. Cannot edit an entry once saved. |
| **Auditor / CA** | Read-only. Ledgers and reports, plus read-only drill-down into any voucher to check its bill image. No voucher menu. |

Every voucher records who entered it and who last changed it, shown at the
bottom of its detail page.

### Time

The application runs on **India time (Asia/Kolkata)** for every "today"
decision — dashboard figures, default voucher dates, report ranges. `TZ` in
`.env` additionally sets the container clock for log timestamps.

---

## What you are building

```
        Internet
            │  HTTPS (443)
     ┌──────▼──────┐
     │    Caddy    │  TLS certificate, auto-renewed
     └──────┬──────┘
            │  HTTP, private network
     ┌──────▼──────┐
     │     app     │  Next.js, runs as a non-root user
     └──────┬──────┘
            │  private network only
     ┌──────▼──────┐
     │  postgres   │  no public port at all
     └─────────────┘

     Volumes: pgdata (database) · uploads (bill images)
```

Four containers on one machine. Nothing is exposed to the internet except Caddy
on ports 80 and 443.

---

## Before you start

| You need | Notes |
|---|---|
| A VPS | 2 GB RAM minimum, 4 GB comfortable. Ubuntu 24.04 LTS. ~$6–12/month (Hetzner, DigitalOcean, Vultr, Linode). |
| A domain | e.g. `fms.yourbusiness.com`. ~$10–15/year. |
| Somewhere off-site for backups | Another cheap VPS, S3/Backblaze, or a hard drive you `scp` to. |
| A terminal | On Windows, PowerShell is fine. |

Pick a VPS region close to your users — Mumbai or Bangalore for India.

---

## Step 1 — Create an SSH key (on your own computer)

An SSH key is a pair of files: a public one you give the server, and a private
one that never leaves your machine. It replaces passwords for login.

In PowerShell on your Windows machine:

```powershell
ssh-keygen -t ed25519 -C "fms-vps"
```

Press Enter to accept the default path (`C:\Users\YOU\.ssh\id_ed25519`). When it
asks for a passphrase, **set one** — it encrypts the key file, so a stolen
laptop is not a stolen server.

Show the public half:

```powershell
Get-Content ~\.ssh\id_ed25519.pub
```

Copy that whole line. It starts with `ssh-ed25519`.

> The matching file *without* `.pub` is your private key. Never send it to
> anyone, never paste it anywhere, never commit it.

---

## Step 2 — Create the VPS

In your provider's dashboard:

- **Image:** Ubuntu 24.04 LTS
- **Size:** 2 GB RAM / 1–2 vCPU
- **SSH key:** paste the public key from Step 1

Do this rather than choosing a root password — it means password login is never
possible in the first place.

Note the server's **IP address**, e.g. `203.0.113.45`.

---

## Step 3 — Point your domain at it

In your domain registrar's DNS settings, add:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `fms` | `203.0.113.45` | 300 |

That creates `fms.yourbusiness.com`. Use `@` as the name if you want the root
domain instead.

Wait a few minutes, then check from your own machine:

```powershell
nslookup fms.yourbusiness.com
```

**It must return your server's IP before you continue.** Caddy proves domain
ownership by answering a challenge on port 80; if DNS is wrong, the certificate
request fails and you will get a browser security warning instead of a site.

---

## Step 4 — First login and a non-root user

```powershell
ssh root@203.0.113.45
```

Running the app as `root` means any mistake is a total compromise. Create a
normal user (replace `fms` with any name you like):

```bash
adduser fms                 # set a strong password when prompted
usermod -aG sudo fms        # allow it to run admin commands
rsync --archive --chown=fms:fms ~/.ssh /home/fms
```

That last line copies your SSH key across so you can log in as the new user.

**Open a second terminal** and confirm it works *before* closing the first:

```powershell
ssh fms@203.0.113.45
```

> Keep the root session open until the new login is proven. Locking yourself out
> of a fresh server is recoverable; locking yourself out of a running one is not.

From here on, everything runs as `fms`.

---

## Step 5 — Update, and turn on automatic security patches

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades   # choose Yes
```

This installs Ubuntu security updates on its own. Without it, the server is
secure the day you build it and progressively less so every week after.

---

## Step 6 — Lock down SSH

```bash
sudo nano /etc/ssh/sshd_config
```

Find and set these three lines (delete any leading `#`):

```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```

Save with `Ctrl+O`, `Enter`, then exit with `Ctrl+X`. Apply:

```bash
sudo systemctl restart ssh
```

**Test in a new terminal before closing this one:**

```powershell
ssh fms@203.0.113.45
```

Password login is now impossible — only your key works. That single change
removes the entire category of password-guessing attacks, which begin within
minutes of a server appearing online.

---

## Step 7 — Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status
```

Only SSH, HTTP, and HTTPS are reachable. Note there is no rule for Postgres —
the database is never exposed, and the compose file deliberately publishes no
port for it.

---

## Step 8 — Block repeat offenders

```bash
sudo apt install -y fail2ban
sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd
```

Bans IPs that fail authentication repeatedly.

---

## Step 9 — Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Log out and back in for the group change to apply:

```bash
exit
```
```powershell
ssh fms@203.0.113.45
```

Verify:

```bash
docker run --rm hello-world
```

---

## Step 10 — Get the code and configure it

```bash
sudo mkdir -p /srv/fms && sudo chown $USER:$USER /srv/fms
git clone <YOUR_REPO_URL> /srv/fms
cd /srv/fms
cp .env.example .env
```

Generate two secrets — run each and copy the output:

```bash
openssl rand -base64 32   # SESSION_SECRET
openssl rand -base64 24   # POSTGRES_PASSWORD
```

```bash
nano .env
```

Fill in the deployment block. The local-development values at the top are
ignored by Docker and can be left alone:

```
SESSION_SECRET="<first generated value>"
POSTGRES_PASSWORD="<second generated value>"
FMS_DOMAIN="fms.yourbusiness.com"
TZ="Asia/Kolkata"
```

Lock the file down — it holds your database password:

```bash
chmod 600 .env
```

> `SESSION_SECRET` signs login cookies. Anyone who has it can forge a session
> for any account. Never reuse the development value, and never commit it.

---

## Step 11 — Start it

```bash
docker compose up -d --build
```

First build takes 3–5 minutes. Then:

```bash
docker compose ps
```

You want `postgres`, `app`, and `caddy` as `running`, and `migrate` as `exited
(0)`. **`migrate` exiting 0 is correct** — it applies database migrations and
stops. If it shows a non-zero exit, the app will not start; see Troubleshooting.

Create the first administrator:

```bash
docker compose run --rm migrate npx tsx scripts/create-user.ts \
  --email you@yourbusiness.com --name "Your Name" --role ADMIN
```

It prints a generated password **once**. Save it in a password manager now.

Everyone else — accountants, your CA — is added from the **Users** screen inside
the app after you sign in. You should not need this command again.

> Do **not** run `db:seed` here. See the warning at the top of this document.

---

## Step 12 — Check it works

Open `https://fms.yourbusiness.com` in a browser.

- The padlock should appear within a minute of first start, while Caddy fetches
  a certificate. If the browser warns about the certificate, wait 60 seconds and
  reload.
- Log in with the account from Step 11.
- Create a purchase voucher and **attach a photo from your phone**. This
  exercises the upload path end-to-end: the image is written to the `uploads`
  volume and served back through the session-checked route.
- Confirm `http://` redirects to `https://`.

---

## Step 13 — Backups

Nothing else holds a copy of your data. Two things must be saved: the database
and the uploaded bill images.

```bash
chmod +x /srv/fms/scripts/backup.sh /srv/fms/scripts/restore.sh
sudo mkdir -p /var/backups/fms && sudo chown $USER:$USER /var/backups/fms
```

Run it once by hand to confirm it works:

```bash
cd /srv/fms && ./scripts/backup.sh
```

You should get a `db-*.dump` and an `uploads-*.tar.gz` in `/var/backups/fms`.

Schedule it nightly at 2 AM:

```bash
crontab -e
```

Add:

```
0 2 * * * cd /srv/fms && ./scripts/backup.sh >> /var/log/fms-backup.log 2>&1
```

### Get them off the machine

**A backup on the same disk as the thing it backs up is not a backup.** If that
disk dies, or the provider suspends the account, both are gone together.

Simplest option — pull them to your own computer nightly:

```powershell
scp fms@203.0.113.45:/var/backups/fms/* D:\backups\fms\
```

Or push to object storage from the server with `rclone`:

```bash
sudo apt install -y rclone
rclone config                     # follow prompts for Backblaze B2 / S3
```

Then append to the cron line:

```
0 3 * * * rclone sync /var/backups/fms remote:fms-backups
```

---

## Step 14 — Prove you can restore

Do this **now**, while nothing matters. An untested backup is a guess.

The honest test is on a second throwaway VPS: run Steps 9–11, copy a backup
across, and run:

```bash
./scripts/restore.sh /path/db-TIMESTAMP.dump /path/uploads-TIMESTAMP.tar.gz
```

It asks for confirmation, stops the app, recreates the database, restores the
images, and restarts. Then log in and check that your vouchers and bill photos
are all there.

Write down how long the whole thing took. That number is your real recovery
time, and it is the only one worth knowing.

---

## Running it day to day

**Deploy an update**

```bash
cd /srv/fms
git pull
docker compose up -d --build
```

Migrations run automatically. Take a backup first if the update includes schema
changes.

**Watch the logs**

```bash
docker compose logs -f app        # application
docker compose logs -f caddy      # TLS and HTTP requests
docker compose logs --tail=100    # everything, recent
```

**Restart**

```bash
docker compose restart app
```

**Add or reset a user**

```bash
docker compose run --rm migrate npx tsx scripts/create-user.ts \
  --email someone@yourbusiness.com --role AUDITOR --update
```

**Roll back a bad deploy**

```bash
git log --oneline -5
git checkout <PREVIOUS_COMMIT>
docker compose up -d --build
```

Code rolls back cleanly. **Database migrations do not.** If the bad release
included a migration, restore from backup instead.

**Free up disk space**

```bash
docker system prune -af          # old images and build cache
df -h                            # check free space
```

---

## Security checklist

Work down this list before you call it live.

- [ ] SSH key login only; `PasswordAuthentication no`
- [ ] Root login disabled
- [ ] `ufw` active — only 22, 80, 443
- [ ] `fail2ban` running
- [ ] `unattended-upgrades` enabled
- [ ] `.env` is `chmod 600`, with secrets never used anywhere else
- [ ] `SESSION_SECRET` is freshly generated, not the development value
- [ ] Postgres publishes no port (`docker compose ps` shows none)
- [ ] Site loads over HTTPS with a valid certificate
- [ ] No `*@fms.local` seed accounts exist in production
- [ ] Real accounts created via the Users screen, passwords in a password manager
- [ ] At least two admin accounts, so losing one is not a lockout
- [ ] Backups running nightly *and* copied off the machine
- [ ] A restore has actually been performed at least once
- [ ] Container logs are size-capped (already configured in `docker-compose.yml`)

---

## Troubleshooting

**Certificate fails / browser security warning**

DNS is the usual cause. Check `dig +short fms.yourbusiness.com` returns your IP,
and that ports 80 and 443 are open. Then `docker compose logs caddy`. Let's
Encrypt rate-limits repeated failures, so fix DNS before retrying.

**`migrate` exits non-zero and the app never starts**

```bash
docker compose logs migrate
```

This is working as designed — a failed migration blocks the rollout instead of
running the app against a half-migrated schema. Fix the migration, then
`docker compose up -d`.

**Uploads fail on large photos**

Two limits must both allow it: `serverActions.bodySizeLimit` in
`next.config.ts` and `request_body max_size` in the `Caddyfile`. Both are 11 MB.
Raise both, or neither.

**Site loads but every login fails**

`SESSION_SECRET` changed, invalidating existing cookies. Clear browser cookies.
If it persists, the account may not exist — list users:

```bash
docker compose exec postgres psql -U fms -d fms -c "select email, role from users;"
```

**Out of disk**

```bash
df -h
docker system prune -af
du -sh /var/backups/fms          # old backups accumulate
```

**Everything is broken and you want a clean slate**

```bash
docker compose down              # keeps data
docker compose up -d --build
```

> `docker compose down -v` deletes the `pgdata` and `uploads` volumes — every
> voucher and every bill image. There is no undo. Only ever use it with a
> verified backup in hand.

---

## What is still on you

Deployment does not cover these. They are worth deciding deliberately.

- **Password resets** — an admin does these from the Users screen. If every
  admin account is lost, recovery is `scripts/create-user.ts` over SSH.
- **Monitoring.** Nothing tells you if the site goes down at 3 AM. A free
  uptime checker (UptimeRobot, Better Stack) pointed at your domain closes this
  in five minutes.
- **Postgres major upgrades.** The image is pinned to `postgres:18-alpine`
  deliberately: Postgres refuses to start against a data directory written by a
  different major version. Upgrading needs a dump-and-restore, not a tag bump.
- **A second admin account.** Create one from the Users screen; if your only
  admin is lost you are recovering over SSH.
