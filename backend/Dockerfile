FROM golang:1.27.4-alpine@sha256:0a5f7fe796599ff487605987432e7619ae45beeb2fba4c2ce0b907879932aebf AS build
WORKDIR /src
ENV GOTOOLCHAIN=local CGO_ENABLED=0
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -trimpath -ldflags="-s -w" -o /calendar ./cmd/server

FROM alpine:3.24@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf
COPY --from=build /calendar /usr/local/bin/calendar
USER 65532:65532
ENV BACKEND_HOST=0.0.0.0 BACKEND_PORT=8080 GIN_MODE=release
EXPOSE 8080
HEALTHCHECK --interval=2s --timeout=2s --start-period=5s --retries=30 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${BACKEND_PORT}/api/owner/meeting-types" || exit 1
ENTRYPOINT ["calendar"]
