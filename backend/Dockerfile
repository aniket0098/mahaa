# =============================================================================
# Mahaa API — production image.
#
# Multi-stage, so the runtime layer carries only the installed Python packages
# and the application itself: no pip cache, no build toolchain, no tests, no
# local `.env`, no source-control metadata.
#
# Runtime configuration is NOT baked in. `DATABASE_URL`, `JWT_SECRET`,
# `CORS_ORIGINS`, `EXPO_ACCESS_TOKEN` and `REDIS_URL` are supplied by the
# environment at run time (Docker Compose locally, Render in production), so no
# secret can ever be read out of a layer of this image.
# =============================================================================


# --- stage 1: builder -------------------------------------------------------
FROM python:3.12-slim AS builder

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build

# Only the dependency manifest first, so a source-only change does not invalidate
# the (expensive) dependency layer.
COPY requirements.txt ./

# Installed into a self-contained prefix rather than site-packages, because that
# is the way to move the packages into the runtime stage without dragging the
# builder's pip or its build tooling along.
#
# No compiler toolchain: `psycopg[binary]`, `argon2-cffi` and the pydantic core
# all ship manylinux wheels, so `gcc`, `build-essential`, `libpq-dev` and Rust
# are not needed. `--no-cache-dir` keeps the wheel cache out of the layer.
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# --- stage 2: runtime -------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# A dedicated unprivileged user. The API never runs as root, so a compromise of
# the process is not immediately root inside the container. `useradd --system`
# allocates a low, unprivileged uid; no password and no login shell.
RUN useradd --system --create-home --home-dir /home/appuser --shell /usr/sbin/nologin appuser

WORKDIR /app

# The dependencies built in stage 1.
COPY --from=builder /install /usr/local

# The application and its migrations, copied by name. `alembic/` and
# `alembic.ini` ship with the image so a migration can be run against a live
# database from this exact image — which is what the one-shot `migrate` service
# in docker-compose.yml does.
COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini pyproject.toml requirements.txt ./

# Readable by the unprivileged user, which is all the API needs: media lives in
# PostgreSQL as BYTEA, so there is no runtime write requirement and no media
# directory is mounted into the container.
RUN chown -R appuser:appuser /app

USER appuser

# Container-internal port. Publishing it to the host is the orchestrator's job
# (`ports: 8000:8000` in Compose), never the image's concern.
EXPOSE 8000

# Liveness only. `/api/v1/health` never touches PostgreSQL, so a transient
# database outage is not reported as a dead application process — that is what
# `/api/v1/ready` is for, and it is deliberately NOT used here.
#
# Written in Python because `python:3.12-slim` ships neither curl nor wget, and
# installing a system package purely to make a healthcheck work is not worth it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=3).status == 200 else 1)"]

# No --reload (this is the production process) and no --workers (the realtime hub
# is per-process; multi-worker fan-out needs REDIS_URL, which is a later phase).
# No Alembic here either: migrations are the one-shot `migrate` service, so
# scaling the API later cannot race a migration.
#
# 0.0.0.0, never 127.0.0.1: inside a container, binding to loopback would make
# the service unreachable from the host and from other containers.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]