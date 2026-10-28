# Source-only candidate. Official registry digest inspected29October2026; root reviews Linux amd64 build before deployment.
FROM clamav/clamav:1.4.6_base@sha256:e73991068f2037e10cf15669dd3b48c24345658f5488430746b414c0f761270f
USER root
RUN apk add --no-cache python3 py3-pip libstdc++ && python3 -m venv /opt/isp-venv
ENV PATH="/opt/isp-venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 CRC32C_PURE_PYTHON=1 PORT=8080 WORKERS=1 THREADS=1 CLOUD_RUN_TIMEOUT_SECONDS=480
WORKDIR /app
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt
COPY policy.py validate_file.py scanner.py mirror.py /app/
RUN mkdir -p /tmp/isp-clamav-definitions /tmp/isp-cvdupdate && chown -R clamav:clamav /tmp/isp-clamav-definitions /tmp/isp-cvdupdate
USER clamav
EXPOSE 8080
# Override only the command to `python /app/mirror.py` for the separate mirror updater job.
ENTRYPOINT ["functions-framework", "--source=/app/scanner.py", "--target=receive_event", "--signature-type=http", "--host=0.0.0.0", "--port=8080"]


CMD []

