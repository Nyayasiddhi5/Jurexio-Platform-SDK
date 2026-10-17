FROM caddy:2.8-builder AS builder
RUN xcaddy build \
        --with github.com/mholt/caddy-ratelimit

FROM caddy:2.8-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
        CMD wget -qO- http://127.0.0.1/health || exit 1
