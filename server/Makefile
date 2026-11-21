SHELL := /bin/bash
VLINT := go run github.com/versatile-sh/go-lint/cmd/vlint@v0.2.0

.PHONY: fmt tools check test

fmt:
	gofmt -w .

tools:
	@command -v golangci-lint >/dev/null || { echo "golangci-lint not found: run mise install" >&2; exit 1; }

check: tools
	test -z "$$(gofmt -l .)"
	go vet ./...
	$(VLINT) golangci -check
	$(VLINT) -baseline lint/vlint-baseline.txt ./...
	golangci-lint run ./...
	$(MAKE) test

test:
	go test -race -count=1 ./...
