FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY denoro_monitor ./denoro_monitor
COPY monitor.py config.example.yaml ./
VOLUME ["/app/data"]
ENTRYPOINT ["python", "monitor.py"]
CMD ["--config", "config.yaml"]
