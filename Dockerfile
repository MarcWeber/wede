# Stage 1: Frontend build (React + Vite, embedded via go:embed)
FROM node:20-alpine AS web

WORKDIR /src
COPY web/ web/
RUN --mount=type=cache,target=/root/.npm \
    cd web && npm ci && npm run build

# Stage 2: Go backend build
FROM golang:1.25-alpine AS backend

RUN apk add --no-cache git make

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY . .
COPY --from=web /src/web/dist backend/cmd/wede/dist
RUN mkdir -p backend/cmd/wede/site && cp -r site backend/cmd/wede/site && \
    cd backend && go build -tags embed_frontend -o /out/wede ./cmd/wede

# Stage 3: Runtime
FROM alpine:3.20

RUN apk add --no-cache git ca-certificates bash ripgrep \
    && adduser -D -u 1000 dev

ENV HOME=/home/dev
RUN mkdir -p /home/dev/work /home/dev/.wede /home/dev/.config/wede \
    && chown -R dev:dev /home/dev

COPY --from=backend /out/wede /usr/local/bin/wede

VOLUME ["/home/dev/work"]
EXPOSE 9090

USER dev
ENTRYPOINT ["/usr/local/bin/wede"]
CMD ["/home/dev/work"]
