# goonersPAY platform
.PHONY: build test race lint vuln sec smoke up down fmt

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

# Production code only: simulators and test tools are excluded, unchecked Close errors (G104) too.
sec:
	go run github.com/securego/gosec/v2/cmd/gosec@v2.29.0 -quiet -exclude=G104 \
		-exclude-dir=cmd/smoke -exclude-dir=cmd/tapsim -exclude-dir=cmd/devpki -exclude-dir=internal/testpg \
		-exclude-dir=internal/schemesim -exclude-dir=internal/pixsim -exclude-dir=internal/testpki -exclude-dir=internal/attest/attesttest ./...

# Needs DATABASE_URL pointing to an empty database.
smoke:
	go run ./cmd/smoke

up:
	docker compose up --build

down:
	docker compose down -v
