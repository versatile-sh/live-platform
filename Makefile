.PHONY: check test

check:
	$(MAKE) -C server check

test:
	$(MAKE) -C server test
