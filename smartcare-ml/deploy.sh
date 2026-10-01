#!/usr/bin/env bash
# Install or update the ML triage service on the server and (re)start it under PM2.
#
#   bash smartcare-ml/deploy.sh                    # first deploy and every update
#   PYTHON=python3.12 bash smartcare-ml/deploy.sh  # if the default python3 is older than 3.11
#
# Nothing is trained here: the models in models/ are committed.
set -euo pipefail
cd "$(dirname "$0")"

PYTHON="${PYTHON:-python3}"
PORT="${ML_PORT:-8000}"

if ! "$PYTHON" -c 'import sys; sys.exit(sys.version_info < (3, 11))'; then
  echo "Python >= 3.11 is required, found: $("$PYTHON" --version 2>&1)"
  echo "Install a newer one (e.g. sudo apt-get install -y python3.12 python3.12-venv)"
  echo "and re-run:  PYTHON=python3.12 bash smartcare-ml/deploy.sh"
  exit 1
fi

[ -x .venv/bin/python ] || "$PYTHON" -m venv .venv
.venv/bin/python -m pip install --quiet --upgrade pip
.venv/bin/python -m pip install --quiet -r requirements.txt

# Models load and answer correctly — checked before the running process is touched.
.venv/bin/python -m src.smoke_test

ML_PORT="$PORT" pm2 startOrRestart ecosystem.config.js --update-env
pm2 save

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "smartcare-ml is up on 127.0.0.1:${PORT}"
    echo "Set AI_SERVICE_URL=http://localhost:${PORT} in the API .env, then: pm2 restart smartcare-api --update-env"
    exit 0
  fi
  sleep 1
done
echo "smartcare-ml did not answer on port ${PORT} — see: pm2 logs smartcare-ml"
exit 1
