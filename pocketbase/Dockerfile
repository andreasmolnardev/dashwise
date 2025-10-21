FROM alpine:latest

ARG PB_VERSION=0.30.4   
ARG TARGETARCH

# Install required tools
RUN apk add --no-cache curl wget unzip

RUN echo "Downloading PocketBase v${PB_VERSION} for ${TARGETARCH}" && \
    case "${TARGETARCH}" in \
      "arm64")  ARCH="arm64";; \
      "amd64")  ARCH="amd64";; \
      *) echo "Unsupported architecture: ${TARGETARCH}" && exit 1;; \
    esac && \
    wget -O /pocketbase.zip https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${ARCH}.zip && \
    unzip /pocketbase.zip -d /app && \
    rm /pocketbase.zip

WORKDIR /app

COPY ./pb_migrations /app/pb_migrations

COPY init_pb.sh /init_pb.sh
RUN chmod +x /init_pb.sh

ENTRYPOINT ["/init_pb.sh"]
