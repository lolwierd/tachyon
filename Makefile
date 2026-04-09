# Tachyon deploy helpers.
#
# Scoped Docker credentials for pulling ghcr.io/lolwierd/tachyon:latest live in
# ./.docker/config.json. The global ~/.docker/config.json is never touched.
# Both the host's compose invocations and the Watchtower container read from
# this repo-local config (see docker-compose.yml volume mount + DOCKER_CONFIG).
#
# `make` with no args: refresh creds from `gh auth token`, pull, and bring the
# stack up in the background.

SHELL := /usr/bin/env bash
.ONESHELL:
.SHELLFLAGS := -eu -o pipefail -c

GHCR_USER ?= lolwierd
GHCR_REGISTRY := ghcr.io
DOCKER_CONFIG_DIR := $(CURDIR)/.docker
DOCKER_CONFIG_FILE := $(DOCKER_CONFIG_DIR)/config.json
COMPOSE := DOCKER_CONFIG=$(DOCKER_CONFIG_DIR) docker compose

.PHONY: up login pull restart down logs ps clean-login

up: login pull
	$(COMPOSE) up -d
	@echo ""
	@echo "Stack is up. Watchtower will poll $(GHCR_REGISTRY) every 5 minutes."
	@echo "Run 'make logs' to tail logs or 'make ps' to list services."

login:
	@if ! command -v gh >/dev/null 2>&1; then
		echo "error: gh CLI not found on PATH" >&2
		exit 1
	fi
	@if ! gh auth status >/dev/null 2>&1; then
		echo "error: gh is not authenticated. Run 'gh auth login' first." >&2
		exit 1
	fi
	@mkdir -p $(DOCKER_CONFIG_DIR)
	@chmod 700 $(DOCKER_CONFIG_DIR)
	@echo "Writing scoped $(GHCR_REGISTRY) credentials to $(DOCKER_CONFIG_FILE)"
	@gh auth token | DOCKER_CONFIG=$(DOCKER_CONFIG_DIR) \
		docker login $(GHCR_REGISTRY) -u $(GHCR_USER) --password-stdin >/dev/null
	@chmod 600 $(DOCKER_CONFIG_FILE)

pull: login
	$(COMPOSE) pull

restart: login
	$(COMPOSE) pull
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f --tail=100

ps:
	$(COMPOSE) ps

clean-login:
	rm -rf $(DOCKER_CONFIG_DIR)
