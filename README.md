# @prisma/extension-read-replicas

This [Prisma Client Extension](https://www.prisma.io/docs/concepts/components/prisma-client/client-extensions) adds read replica support to your Prisma Client. Under the hood, this extension creates additional Prisma Clients for the read replica database connection strings, and then routes read queries to these Clients instead of using the primary Prisma Client.

## Requirements

Requires Prisma 5.2+.

## Installation

Depending on the package manager of your choice:

### `npm`

```sh
npm install @prisma/extension-read-replicas
```

### `yarn`

```sh
yarn add @prisma/extension-read-replicas
```

### `pnpm`

```sh
pnpm add @prisma/extension-read-replicas
```

## Usage

### Initialization

```ts
import { PrismaClient } from '@prisma/client'
import { readReplicas } from '@prisma/extension-read-replicas'

const prisma = new PrismaClient().$extends(
  readReplicas({
    url: 'postgresql://replica.example.com:5432/db',
  }),
)
```

All non-transactional read queries will now be executed against the defined replica.
Write queries and transactions will be executed against the primary server.

**Note**: `queryRaw` and `executeRaw` are always executed against the primary server by default since
the extension can not know for sure if a particular raw query would read or write to the database.
Use the `$replica()` method to explicitly route the request to a read replica.

### Multiple replicas

You can also initialize the extension with an array of replica connection strings:

```ts
const prisma = new PrismaClient().$extends(
  readReplicas({
    url: [
      'postgresql://replica-1.example.com:5432/db',
      'postgresql://replica-2.example.com:5432/db',
    ],
  }),
)
```

In this case, a replica for each read query will be selected randomly.

### Pre-configured clients

If you want to supply additional options to replica client, you can also pass pre-configured read clients instead of urls:

```ts
const replicaClient = new PrismaClient({
  datasourceUrl: 'postgresql://replica.example.com:5432/db'
  log: [{ level: 'query', emit: 'event' }]
})

replicaClient.$on('query', (event) => console.log('Replica event', event))

const prisma = new PrismaClient().$extends(
  readReplicas({
    replicas: [
      replicaClient
    ],
  }),
)
```

### Bypassing the replicas

If you want to execute a read query against the primary server, you can use the `$primary()` method on your extended client:

```ts
prisma.$primary().user.findMany({ where: { ... }})
```

### Forcing request to go through a replica

Sometimes you might want to do the opposite and route the request to a replica even though
it will be routed to primary by default. In that case, you can use the `$replica()` method:

```ts
prisma.$replica().$queryRaw`SELECT ...`
```

### Caveats and limitations

- At the moment, if you are using this read replicas extension alongside other extensions, this extension should be applied last:

  ```ts
  const prisma = new PrismaClient()
    .$extends(withAccelerate())
    .$extends(rlsExtension())
    .$extends(
      readReplicas({
        url: 'postgresql://replica.example.com:5432/db',
      }),
    )
  ```

- If you use the read replicas extension with Prisma version below 5.1, any result extensions will not work.

## Development

Note: To run the tests, you need to have Docker installed and running.

- Run `docker-compose up` to start the Postgres primary and replica
- Set the environment variables `DATABASE_URL` and `REPLICA_URL` to the connection strings for the primary and replica:

  ```sh
  export DATABASE_URL='postgresql://prisma:prisma@localhost:6432/test'
  export REPLICA_URL='postgresql://prisma:prisma@localhost:7432/test'
  ```

- Run `pnpm test` to run the tests
