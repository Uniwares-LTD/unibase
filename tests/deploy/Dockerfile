FROM node:24.16.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 curl util-linux shellcheck && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
ENV UNIBASE_DEPLOY_TEST_CONTAINER=1
CMD ["python3", "-B", "-m", "unittest", "discover", "-s", "tests/deploy", "-v"]
