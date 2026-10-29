# InfinityPay+ platform
.PHONY: build test race lint vuln smoke up down fmt

build:
	go build ./...

test:
	go test ./...

race:
	go test -race -count=1 ./...

fmt:
	gofmt -l -w .

lint:
	@test -z "$$(gofmt -l .)" || (gofmt -l . && echo "run make fmt" && exit 1)
	go vet ./...
	go run honnef.co/go/tools/cmd/staticcheck@v0.8.2 ./...

vuln:
	go run golang.org/x/vuln/cmd/govulncheck@v1.8.0 ./...

# Needs DATABASE_URL pointing to an empty database.
smoke:
	go run ./cmd/smoke

up:
	docker compose up --build

down:
	docker compose down -v
