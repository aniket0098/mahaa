# =============================================================================
# Mahaa Message service — production image.
#
# Built INDEPENDENTLY of the main backend: the build context is this directory,
# nothing outside it is copied, and the two images never share a layer cache
# entry that could let one Dockerfile drift into the other's source.
#
# Adapted from `backend/Dockerfile`, not copied: this service has no argon2, no
# Redis client, no realtime hub and no WebSocket route, so neither the
# dependencies nor the process arguments are the same.
#
# Runtime configuration is NOT baked in. `DATABASE_URL`, `JWT_SECRET`,
# `JWT_ISSUER`, `JWT_AUDIENCE`, `CORS_ORIGINS`, `APP_ENV` and `PORT` are
# supplied by the environment at run time (a local shell locally, Render's
# environment in production), so no secret can ever be read out of a layer.
# =============================================================================


# --- stage 1: builder -------------------------------------------------------
FROM python:3.12-slim AS builder

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build

# Only the dependency manifest first, so a source-only change does not
# invalidate the (expensive) dependency layer.
COPY requirements.txt ./

# Installed into a self-contained prefix rather than site-packages, because
# that is the way to move the packages into the runtime stage without dragging
# the builder's pip or its build tooling along. No compiler toolchain: every
# dependency here ships manylinux wheels.
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# --- stage 2: runtime -------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    # Render injects PORT; 8001 is the local default so this service and the
    # main API (8000) can run side by side on one machine.
    PORT=8001

# A dedicated unprivileged user: a compromise of the process is not
# immediately root inside the container.
RUN useradd --system --create-home --home-dir /home/appuser --shell /usr/sbin/nologin appuser

WORKDIR /app

# The dependencies built in stage 1.
COPY --from=builder /install /usr/local

# The application and its migrations, copied by name. `.env`, `.git`, tests
# and the sibling `backend/` directory are never in the build context (see
# .dockerignore), so they cannot be copied by accident.
COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini pyproject.toml requirements.txt ./

RUN chown -R appuser:appuser /app

USER appuser

# Container-internal port. Publishing it to the host is the orchestrator's job,
# never the image's concern.
EXPOSE 8001

# Liveness only. `/api/v1/health` never touches PostgreSQL, so a transient
# database outage is not reported as a dead application process — that is what
# `/api/v1/ready` is for, and it is deliberately NOT used here.
#
# Written in Python because `python:3.12-slim` ships neither curl nor wget.
# The port is read from the environment so a container started with a
# different PORT is still probed on the port it actually listens on.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import os, sys, urllib.request; port = os.environ.get('PORT', '8001'); url = f'http://127.0.0.1:{port}/api/v1/health'; sys.exit(0 if urllib.request.urlopen(url, timeout=3).status == 200 else 1)"]

# Shell form, deliberately: the runtime PORT is an environment variable and
# only a shell expands it. One uvicorn process, no --workers (this service is
# stateless REST; scaling workers is a Render-side decision) and no --reload
# (this is the production process).
#
# `exec` is essential: it makes uvicorn REPLACE the shell and become PID 1, so
# a `docker stop` SIGTERM reaches uvicorn directly and it shuts down gracefully
# (exit 0). Without it the shell stays PID 1, swallows the signal, and Docker
# has to SIGKILL the container after the stop timeout — exit code 137.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8001}"]
