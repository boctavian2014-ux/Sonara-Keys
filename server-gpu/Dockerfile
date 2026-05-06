# GPU image intended for CUDA-capable hosts (RunPod/Modal/VM GPU).
# Pin a CUDA runtime image and install Python deps.

FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
  PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv ffmpeg libsndfile1 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

COPY app.py ./

EXPOSE 8789

# Longer keep-alive helps slow GPU inference behind reverse proxies (e.g. RunPod).
CMD ["python3","-m","uvicorn","app:app","--host","0.0.0.0","--port","8789","--timeout-keep-alive","180"]

