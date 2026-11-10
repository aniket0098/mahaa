FROM python:3.12-slim AS builder
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /build
COPY requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt
FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8001
RUN useradd --system --create-home --home-dir /home/appuser --shell /usr/sbin/nologin appuser
WORKDIR /app
COPY --from=builder /install /usr/local
COPY app/ ./app/
COPY pyproject.toml requirements.txt ./
RUN chown -R appuser:appuser /app
USER appuser
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import os, sys, urllib.request; port = os.environ.get('PORT', '8001'); url = f'http://127.0.0.1:{port}/api/v1/health'; sys.exit(0 if urllib.request.urlopen(url, timeout=3).status == 200 else 1)"]
CMD ["sh", "-c", "exec uvicorn app.main:create_app --factory --host 0.0.0.0 --port ${PORT:-8001}"]
