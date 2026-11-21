.PHONY: check test semgrep

check:
	$(MAKE) -C server check
	$(MAKE) --no-print-directory semgrep

test:
	$(MAKE) -C server test

SEMGREP_RULES := https://raw.githubusercontent.com/versatile-sh/semgrep-rules/v0.1.2/rules/versatile.yml

semgrep:
	semgrep scan --metrics=off --disable-version-check --error --severity WARNING --severity ERROR \
		--config p/default --config p/secrets --config p/golang --config p/typescript --config p/react --config p/dockerfile --config $(SEMGREP_RULES) \
		--baseline-commit "$$(git merge-base HEAD origin/main)"
