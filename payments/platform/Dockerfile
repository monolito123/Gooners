# syntax=docker/dockerfile:1
# Multi-stage build: static binaries on a distroless, non-root base image.
FROM golang:1.26.10-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/ ./cmd/platform ./cmd/schemesim ./cmd/pixsim ./cmd/devpki ./cmd/tapsim

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/ /usr/local/bin/
USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/platform"]
CMD ["serve"]
