FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY migrations ./migrations
# 워커 1개 유지 — 팝업 상태가 메모리에 있음 (DB 이관 전까지)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
