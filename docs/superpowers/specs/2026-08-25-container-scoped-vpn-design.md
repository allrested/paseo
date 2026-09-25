# Container-scoped SSL-VPN for internal repository access

Date: 2026-08-25
Status: implemented

## Problem

Agents running in the Docker stack need to reach a self-hosted Git server and
other services on a private corporate network behind a FortiGate SSL-VPN. The
obvious approach — running the VPN client on the Docker host — was tried and
locked the operator out of the server, requiring an out-of-band restart to
recover.

Measurement of the actual gateway ruled out the obvious explanation. The gateway
does **not** push a default route; it is already split-tunnel, offering a list
of specific routes. None of those routes captures the server's own addresses —
neither its subnet nor any of the bridge networks Docker had allocated on it.

So the mechanism of the original lockout is **unconfirmed**. The likeliest
remaining candidates are client-side rather than gateway-side: on Linux `pppd`
installs a default route unless explicitly told not to, and the client rewrites
`/etc/resolv.conf` by default. Either would sever a server's connectivity while
leaving a Windows client, which follows a different configuration path, looking
harmless.

This design deliberately does not depend on knowing which one it was. Every
candidate — a pushed default route, a client-installed one, a captured subnet, a
replaced resolver — shares one precondition: the tunnel is configured in a
namespace the host shares. Removing that precondition removes the whole class.
Confining the tunnel to a container is therefore not a mitigation of a diagnosed
fault; it is the reason the fault becomes unreachable.

## Goal

Give the `paseo` and `browser` containers transparent access to private network
destinations while:

1. never modifying the host's routing table, DNS configuration, or interfaces;
2. keeping direct internet access inside both containers, so agent CLIs continue
   to reach their providers and package registries;
3. never installing a route that can capture a network the container itself
   depends on;
4. remaining entirely optional — the existing stack must run unchanged when the
   feature is not enabled;
5. containing no organisation-specific hostname, address range, realm, or
   credential in any tracked file.

## Non-goals

- Host-level VPN access. Nothing outside the containers gains private access.
- Protocols other than FortiGate SSL-VPN. IPsec and ZTNA are out of scope.
- Interactive authentication. This design assumes username/password auth with
  no second factor. TOTP, push approval, and SAML would each need their own
  design.
- **Honouring the gateway's route list.** Routes are declared locally and
  curated. See Route curation for why this is a goal rather than a compromise.
- Private DNS. Measured unnecessary; see Resolution.

## Approach

A dedicated container runs the SSL-VPN client and acts as a routed gateway on
the stack's existing network. The tunnel exists only in that container's network
namespace. Two sidecars install routes for the declared CIDRs into the `paseo`
and `browser` namespaces, pointing at that gateway.

`paseo` and `browser` gain no new network, no DNS override, and no
capabilities: their definitions are identical to the ones in the base file, and
a test enforces that. Everything the feature needs sits in services beside
them.

Two rejected alternatives, recorded because the reasons still apply:

**Joining the gateway's namespace** (`network_mode: "service:vpn"` on `paseo`
and `browser`) would move every published port onto the gateway service,
re-point both CDP sidecars, move the proxy network, and collapse `paseo` and
`browser` into one namespace — where the browser's noVNC port collides directly
with `DEV_PORT_INTERNAL`. It rewrites working code to gain nothing, and makes
the VPN mandatory rather than optional.

**A SOCKS proxy in the gateway container** needs no routing changes and no
elevated capabilities outside the gateway. It remains the fallback if `/dev/ppp`
proves unavailable. It was rejected because it only serves proxy-aware tools: an
agent running `curl` against an internal API, or a package manager pointed at an
internal registry, would fail.

## Route curation

This section carries the design's most important constraint, so it records the
evidence behind it.

The gateway pushes 113 routes. Of those, **78 are public address space** —
cloud-provider compute and object-storage prefixes, and individual host routes
inside a large CDN's anycast ranges. Installing that list inside the container
would route parts of the public internet through the corporate tunnel, which is
the original failure reproduced one layer in.

At the time of measurement, none of the eight endpoints the agents depend on
(the two model providers, the npm registry, the container registry, GitHub, its
asset hosts, and one agent CLI's release host) fell inside a pushed route. That
result is not durable: one provider's API currently resolves to an anycast
address inside a `/16` where the gateway already claims two host routes. CDN
addresses rotate within their ranges, so a list that is safe today can capture a
provider API tomorrow, with no change on either side.

One pushed route is a `/20` inside `172.16.0.0/12` — Docker's own default
address pool. It did not collide with the deployment host measured here, whose
bridges sit lower in that block, but Docker allocates from the pool on demand
and a future network can land inside it. Declaring that range would let the
tunnel capture the very bridge a container uses to reach its gateway.

Therefore:

- `INTERNAL_CIDRS` is **declared locally, never imported.** Start with the
  single range containing the Git server; add ranges when something is actually
  unreachable.
- The gateway entrypoint **refuses to start** when a declared CIDR is outside
  RFC 1918, is shorter than a `/12`, or overlaps the container's own address or
  default gateway.

The prefix-length floor is the one rule that is not self-evident. The container
can see its own interfaces, so it can catch a range covering those; it cannot
see the Docker host's subnet, so a declared `10.0.0.0/8` would pass every other
check while capturing the host and everything else in its network. No plausible
"internal service range" needs a `/8`, so refusing one costs nothing and closes
the only foot-gun the container cannot otherwise detect.

The validation is deliberately strict with no override flag. When a genuine
need for a public-space or very broad route appears, that is the moment to
design for it.

## Resolution

No DNS component. Measurement showed the private Git server's name resolving
correctly through **public** resolvers, which return its RFC 1918 address
directly. Nothing needs overriding, so `paseo` and `browser` keep Docker's
embedded resolver untouched.

This deletes what had been the design's most fragile part: pointing `dns:` at a
container meant that container's death took down all name resolution, including
container-name lookups the stack itself relies on.

Contingency, noted rather than built: if some other internal service turns out
to resolve only on private DNS, a resolver in the gateway container forwarding
that suffix is the answer. Building it now, against a problem measured as
absent, would be paying for it twice.

## Components

### 1. The gateway image — `docker/Dockerfile.vpn`

`FROM debian:bookworm-slim`, matching the base image so the stack has one
userland. Installs `openfortivpn`, `ppp`, `iptables`, `iproute2`,
`netcat-openbsd`, `ca-certificates`. An apt-only build of roughly 50 MB.

Built here rather than pulled from a third party: this container holds live VPN
credentials and a route into a private network, which makes it the worst place
in the stack to run an unreviewed image.

Published to GHCR alongside the other two images, so deploys stay pull-based.
The same image runs the route sidecars — it already carries `iproute2`.

### 2. The gateway entrypoint

Runs, in order:

1. **Validate configuration.** Required variables must be present, and every
   entry in `INTERNAL_CIDRS` must pass the Route curation checks. The container
   exits naming the specific failure. A tunnel that comes up and reaches nothing
   is harder to diagnose than a container that refuses to start.
2. **Write `/etc/openfortivpn/config`, mode `0600`, from the environment.**
   Credentials are never baked into the image and never passed as command-line
   arguments, which would expose them through `ps` inside the container.
3. **Install NAT and forwarding rules.** `POSTROUTING ... -o ppp0 -j
MASQUERADE`, with a `FORWARD` policy of `DROP` and accept rules only for
   traffic destined to the declared CIDRs. A mistaken route in a sidecar
   therefore cannot push unrelated traffic up the corporate tunnel.
4. **Run the client in a retry loop with backoff,** with its own route and DNS
   management disabled — this is what discards the gateway's 113-route list.
   The flag spelling differs across versions (`--no-routes`/`--no-dns` versus
   `--set-routes=0`/`--set-dns=0`); implementation pins whichever the packaged
   version accepts, verified against `openfortivpn --help` in the image.

Routes are added from `/etc/ppp/ip-up.d/10-internal-routes`, which `pppd` runs
when the link comes up — event-driven rather than polled. It adds exactly the
declared CIDRs via `ppp0` and **no default route**: the gateway container keeps
its normal internet path, which the client's own TLS connection depends on.

### 3. Networking

The gateway joins the stack's existing `default` network. No new network, no
pinned subnet, no static address — with the DNS override gone, nothing needs a
fixed address any more.

### 4. Route sidecars

`paseo-vpn-route` and `browser-vpn-route` run the gateway image with
`network_mode: "service:<target>"` and `NET_ADMIN`. Each resolves the gateway
container by name and asserts `ip route replace <cidr> via <address>` on a slow
loop. Resolving by name every iteration means a recreated gateway with a new
address is picked up without intervention; `replace` is idempotent, so the loop
self-heals rather than accumulating state.

Targeting the gateway by **container** name, not service name, matters for the
same reason the existing `paseo-cdp` comment records: on a shared proxy network
every instance's service carries the same DNS alias, so a service name can
resolve to another instance's container.

This borrows the idiom the stack already uses for `paseo-cdp` and
`browser-cdp`: a sidecar enters a namespace to do one privileged thing, so the
main containers stay unprivileged. It inherits that idiom's known limitation
too — recreating `paseo` leaves the sidecar running in the old namespace, Up
and useless. It is handled the same way: a healthcheck that can only pass from
the live namespace, verifying the routes are actually present, so a zombie
reports unhealthy instead of lying.

### 5. Composition

`docker/docker-compose.vpn.yml` is a complete stack — the four services of
`docker-compose.yml` plus the gateway and the two route sidecars:

```
docker compose -f docker-compose.vpn.yml up -d
```

An instance runs one file or the other. Instances that do not need the VPN
point at `docker-compose.yml` and are untouched by this feature, which is what
keeps it optional and the base file free of organisation-specific concerns.

This replaces two earlier designs, both defeated by the same constraint.
An overlay applied with a second `-f` cannot be expressed by a deploy tool
whose configuration is a single compose path. A wrapper file using Compose
`include:` parses correctly for Compose itself but not for every tool that
reads the file: Dokploy reported `Services not found`, discovered no services,
and failed validation for every domain attached to the stack — after the
containers were already running. The cost of the surviving design is that the
four shared services are duplicated, so a test asserts they stay identical to
the base file.

Multi-instance deployments need no extra coordination beyond the existing
distinct `INSTANCE_NAME`.

### 6. SSH access to the private Git server

Transport is SSH with a deploy key.

The key lives at `/home/paseo/.ssh/internal_key` inside the container, in the
`PASEO_HOME_DIR` volume already mounted at `/home/paseo` — no separate mount
carries it there. On the host it must be `chown 1000:1000` and `chmod 600` —
uid 1000 is the `paseo` user, and OpenSSH refuses a group-readable private
key. Both failures produce messages that do not name the file, so the
documentation carries the exact commands.

The agents entrypoint writes `/etc/ssh/ssh_config.d/10-internal.conf` from the
environment at every start. Debian's `ssh_config` already includes that
directory, and writing into an image layer rather than the mounted volume makes
it idempotent without dedupe logic:

```
Host ${INTERNAL_SSH_HOST}
  IdentityFile /home/paseo/.ssh/internal_key
  IdentitiesOnly yes
GlobalKnownHostsFile /etc/ssh/ssh_known_hosts /etc/ssh/ssh_known_hosts.extra
```

`IdentitiesOnly` is confined to a `Host` block deliberately; applied globally it
breaks GitHub authentication.

`SSH_KNOWN_HOSTS_EXTRA`, obtained with `ssh-keyscan` while the tunnel is up,
becomes `/etc/ssh/ssh_known_hosts.extra`. Without it the first clone fails with
`Host key verification failed`, because `Dockerfile.agents` pins GitHub's keys
and nothing else.

### 7. Configuration

All values are placeholders in `.env.example` and real only in the gitignored
`.env` or the deployment platform's environment settings.

| Variable                       | Purpose                                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `VPN_IMAGE`                    | Published gateway image and tag                                                                                                              |
| `VPN_GATEWAY`, `VPN_PORT`      | SSL-VPN gateway host and port                                                                                                                |
| `VPN_USERNAME`, `VPN_PASSWORD` | Credentials                                                                                                                                  |
| `VPN_TRUSTED_CERT`             | Gateway certificate SHA256. The client requires it on first connect; pinning it is also what prevents a machine-in-the-middle. Not a secret. |
| `VPN_REALM`                    | Set only if the portal is realm-scoped. A missing realm fails authentication in a way that looks like a wrong password.                      |
| `INTERNAL_CIDRS`               | Comma-separated, curated, RFC 1918 only. The definition of "internal".                                                                       |
| `VPN_HEALTH_TARGET`            | `host:port` the gateway healthcheck connects to                                                                                              |
| `INTERNAL_SSH_HOST`            | Host the deploy key and its config block apply to                                                                                            |
| `INTERNAL_SSH_KEY_FILE`        | Path inside the container to the deploy key, which lives in the paseo-home volume                                                            |
| `SSH_KNOWN_HOSTS_EXTRA`        | Host keys for the private Git server                                                                                                         |

## Health

Both healthchecks assert the thing that actually matters rather than a proxy for
it, following the reasoning already recorded in the compose file about noVNC
saying nothing about Chromium.

- **Gateway:** a TCP connection to `VPN_HEALTH_TARGET`. A tunnel that is up but
  routing nowhere reports unhealthy. With the variable unset it falls back to
  asserting `ppp0` exists, which is weaker but keeps the generic default
  working.
- **Route sidecars:** the declared routes are present in the current namespace.

## Failure behaviour

| Failure                                                                                          | Effect                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tunnel drops                                                                                     | Private destinations time out. Gateway unhealthy, client retries with backoff. Internet and DNS in `paseo` and `browser` unaffected.                       |
| Gateway container dies                                                                           | Private access gone. Everything else — internet, DNS, container-name resolution — is untouched, because no service depends on it for anything but routing. |
| `paseo` or `browser` recreated                                                                   | Route sidecar becomes a namespace zombie: unhealthy, private access lost until it is force-recreated. Internet unaffected.                                 |
| Declared CIDR outside RFC 1918, shorter than a `/12`, or overlapping the container's own network | Gateway refuses to start, naming the offending range.                                                                                                      |
| Bad or expired credentials                                                                       | Gateway fails loudly and retries. Nothing else is touched.                                                                                                 |
| Host reboot                                                                                      | `ppp_generic` is restored by `modules-load.d`. If absent, the gateway fails fast naming the module.                                                        |
| Gateway pushes a route list that captures public or host address space                           | Discarded. Only the declared CIDRs are installed.                                                                                                          |
| Any of the above                                                                                 | The host's routing table and `resolv.conf` are unmodified. No service uses host networking or mounts host `/etc`.                                          |

## Host prerequisites

1. `ppp_generic` loaded and persisted in `/etc/modules-load.d/`. Not present in
   every minimal cloud image; some require the distribution's extra-modules
   package for the running kernel. Verified with `modprobe ppp_generic` and the
   existence of `/dev/ppp`.
2. Any host-level VPN client from earlier attempts must be stopped **and
   disabled**, or it will reinstall its route list on the next boot and
   reproduce the original lockout.
3. Record the host's own private address and the Docker address pool in use
   before choosing `INTERNAL_CIDRS`. A declared range that contains either is
   the failure this design exists to prevent, and the entrypoint check is a
   backstop, not a substitute for looking.

The gateway container receives `NET_ADMIN`, `/dev/ppp`, and
`net.ipv4.ip_forward=1`. It is not privileged. No other service gains
capabilities; the route sidecars get `NET_ADMIN` only.

## Files

New:

- `docker/Dockerfile.vpn`
- `docker/vpn/rootfs/usr/local/bin/paseo-vpn-entrypoint`
- `docker/vpn/rootfs/usr/local/bin/paseo-vpn-healthcheck`
- `docker/vpn/rootfs/usr/local/bin/paseo-vpn-config` — renders
  `/etc/openfortivpn/config` from the environment
- `docker/vpn/rootfs/usr/local/bin/paseo-vpn-validate` — the curation guard,
  run from both the gateway entrypoint and the route sidecars
- `docker/vpn/rootfs/usr/local/bin/paseo-vpn-route` — the sidecar's assert loop
  and its healthcheck
- `docker/vpn/rootfs/etc/ppp/ip-up.d/10-internal-routes`
- `docker/docker-compose.vpn.yml` — the complete VPN-enabled stack
- `docker/agents/rootfs/usr/local/bin/paseo-agents-ssh-setup` — writes the SSH
  config block and known-hosts file for the private git server
- `scripts/vpn-overlay.test.mjs`
- `.gitattributes` — forces LF endings on the rootfs shell scripts

Modified:

- `docker/docker-compose.yml` — three SSH variables added to the `paseo`
  service's environment. See Verification item 2 for why the overlay could
  not carry these instead.
- `docker/Dockerfile.agents` — generated `ssh_config.d` snippet and extra
  known-hosts file
- `docker/.env.example` — new section, placeholders only
- `.github/workflows/docker.yml` — a `publish-vpn` job and a `push: false`
  build on the pull-request path. It depends on `setup` alone, not `publish`,
  because the image is not layered on the paseo base and can build in parallel.
  Tagged with the same version as the others so one number pins the whole
  stack.
- `docker/README.md`, `docs/docker.md` — an optional private-network section

## Verification

Infrastructure, so a smoke checklist rather than unit tests. The first two items
carry the weight.

1. **Host invariant.** Capture `ip route show` and `/etc/resolv.conf` on the
   host before anything runs. Re-diff after `up` and again after `down`. An
   empty diff is the acceptance test for the entire feature.
2. **Overlay-off regression.** Not byte-identical: `docker/docker-compose.yml`
   itself gained three SSH variables in the `paseo` service, because Compose
   only injects a variable into a container when the service's own
   `environment:` block names it, and the overlay is forbidden from touching
   `paseo`. There was nowhere else to put them. What still holds without the
   overlay: `docker compose -f docker-compose.yml config` matches the base
   file's own content one-to-one, and applying the VPN overlay to a running
   stack recreates no existing container.
3. Overlay parses: `docker compose -f docker-compose.yml -f
docker-compose.vpn.yml config`.
4. **Curation guard.** With a public range or a range covering the container's
   own network in `INTERNAL_CIDRS`, the gateway exits naming it. This is a test,
   not just a safeguard — run it deliberately. The guard also runs inside
   `paseo-vpn-route` and `browser-vpn-route`, in the namespace they borrow,
   before those sidecars install a single route. The sidecar is the one that
   matters: it runs inside `paseo`'s namespace, which also joins
   `dokploy-network`, a network the gateway container never joins and so
   cannot check on `paseo`'s behalf.
5. Gateway reports healthy. `ppp0` has an address, carries only the declared
   CIDRs, and has no default route.
6. From `paseo`: a private name resolves and connects; `paseo-browser` still
   resolves; `curl -sfI https://api.anthropic.com` still succeeds.
7. From `paseo`: `ssh -T` against the private Git server authenticates, and a
   real clone of a small repository succeeds.
8. From `browser` over noVNC: the private web UI loads, and a public site still
   loads.
9. Failure drill: stop the gateway container, confirm public traffic and DNS
   from `paseo` still work, start it, confirm private access returns with
   nothing else touched.
