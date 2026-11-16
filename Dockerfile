FROM golang:1.27.4-alpine AS build
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /live ./cmd/live

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /live /live
ENV HOST=0.0.0.0 PORT=3000 SIGNAL_PORT=3001
EXPOSE 3000 3001
ENTRYPOINT ["/live"]
