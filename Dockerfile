FROM node:22.22.2-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS frontend-build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.27.4-alpine@sha256:0a5f7fe796599ff487605987432e7619ae45beeb2fba4c2ce0b907879932aebf AS backend-build
WORKDIR /src/backend
ENV GOTOOLCHAIN=local CGO_ENABLED=0
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/cmd/ ./cmd/
COPY backend/internal/ ./internal/
RUN go build -trimpath -ldflags="-s -w" -o /calendar ./cmd/server

FROM alpine:3.24@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf
COPY --from=backend-build /calendar /usr/local/bin/calendar
COPY --from=frontend-build /src/frontend/dist /app/public
USER 65532:65532
ENV BACKEND_HOST=0.0.0.0 PORT=8080 GIN_MODE=release FRONTEND_DIR=/app/public
EXPOSE 8080
HEALTHCHECK --interval=2s --timeout=2s --start-period=5s --retries=30 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${BACKEND_PORT:-$PORT}/" && wget -q -O /dev/null "http://127.0.0.1:${BACKEND_PORT:-$PORT}/api/owner/meeting-types" || exit 1
ENTRYPOINT ["calendar"]
