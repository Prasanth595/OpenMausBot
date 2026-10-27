# The hiring demo as ONE Fly machine: the OpenMausBot server with Claude Code, Desk ATS on loopback, and Caddy on :8080
# in front of the loopback-only server. Fly terminates TLS for the demo's domain and forwards to :8080. Build from the
# repository root:  docker build --platform linux/amd64 -f deploy/hiring-demo/fly/Dockerfile .
ARG BASE_IMAGE=ghcr.io/milind-soni/openmausbot:latest
FROM caddy:2.10.2 AS edge
RUN cp /usr/bin/caddy /caddy

FROM ${BASE_IMAGE}
USER root
RUN HOME=/tmp/omb-build-home npm install -g @anthropic-ai/claude-code && rm -rf /tmp/omb-build-home /tmp/node-compile-cache
COPY --from=edge /caddy /usr/local/bin/caddy
WORKDIR /hiring
COPY deploy/hiring-demo/ats/package.json deploy/hiring-demo/ats/package-lock.json ats/
RUN cd ats && HOME=/tmp/omb-build-home npm ci --omit=dev && npm cache clean --force && rm -rf /tmp/omb-build-home
COPY deploy/hiring-demo/ats/src ats/src
COPY deploy/hiring-demo/ats/public ats/public
COPY deploy/hiring-demo/ats/data/seed.json ats/data/seed.json
COPY deploy/hiring-demo/ats/config.example.json ats/
COPY deploy/hiring-demo/template template
COPY deploy/hiring-demo/fly/Caddyfile /etc/caddy/Caddyfile
COPY deploy/hiring-demo/fly/start.sh /usr/local/bin/hiring-start
# The bots' shared folder lives on the volume; the template and setup script expect it at /desk.
RUN chmod 0755 /usr/local/bin/hiring-start && ln -s /data/desk /desk && chown -R root:root /hiring && chmod -R a+rX /hiring
WORKDIR /app
ENV HOME=/data \
    OMB_PORT=8799 \
    OMB_WEBHOOK_PORT=8800 \
    ATS_STATE=/data/ats-state/state.json \
    ATS_CONFIG=/data/ats-state/config.json \
    DESK_FOLDER=/desk/recruiting-desk
EXPOSE 8080
# Starts as root only to hand a fresh volume to `maus`; every process runs as `maus`.
CMD ["/usr/local/bin/hiring-start"]
