FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . /app/mcp_server
CMD ["python", "/app/mcp_server/server.py"]
