# Docker Local Setup

This project no longer needs Replit to run locally. The Docker stack starts:

- Postgres on `localhost:15432`
- API on `http://localhost:3001/api`
- Dashboard on `http://localhost:33000`
- A local Docker runtime provider for agent deployments

## Start

```powershell
docker compose up --build
```

Open the dashboard:

```text
http://localhost:33000
```

The API health check is:

```text
http://localhost:3001/api/healthz
```

## Run API Tests From Windows

In a new PowerShell window after the stack is running:

```powershell
$env:DATABASE_URL="postgres://bridge:bridge@localhost:15432/architecture_bridge"
corepack pnpm --filter @workspace/api-server test
```

## Stop

```powershell
docker compose down
```

To remove the local database volume too:

```powershell
docker compose down -v
```

## Runtime Note

The API service mounts the local Docker socket so `docker-local` deployments can start a small runtime container per deployment. That is appropriate for local development on Docker Desktop, but production should use a dedicated runtime adapter with scoped credentials rather than a raw Docker socket.
