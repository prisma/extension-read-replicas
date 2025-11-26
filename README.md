# @prisma/extension-read-replicas

This [Prisma Client Extension](https://www.prisma.io/docs/concepts/components/prisma-client/client-extensions) adds read replica support to your Prisma Client. Under the hood, this extension routes read queries to pre-configured replica Prisma Clients instead of using the primary Prisma Client.

## Requirements

Requires Prisma 7.0+.

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

### Initialization with Driver Adapters

With Prisma 7, you must configure your PrismaClient instances with either a driver adapter or an accelerateUrl. Here's an example using driver adapters:

```ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { readReplicas } from '@prisma/extension-read-replicas'
import { Pool } from 'pg'

const mainAdapter = new PrismaPg(
  new Pool({ connectionString: process.env.DATABASE_URL }),
)

const replicaAdapter = new PrismaPg(
  new Pool({ connectionString: process.env.REPLICA_URL }),
)

const replicaClient = new PrismaClient({ adapter: replicaAdapter })

const prisma = new PrismaClient({ adapter: mainAdapter }).$extends(
  readReplicas({
    replicas: [replicaClient],
  }),
)
```

### Initialization with Accelerate URLs

You can also use Prisma Accelerate URLs:

```ts
import { PrismaClient } from '@prisma/client'
import { readReplicas } from '@prisma/extension-read-replicas'

const replicaClient = new PrismaClient({
  accelerateUrl: process.env.REPLICA_ACCELERATE_URL,
})

const prisma = new PrismaClient({
  accelerateUrl: process.env.ACCELERATE_URL,
}).$extends(
  readReplicas({
    replicas: [replicaClient],
  }),
)
```

### Multiple replicas

You can pass multiple replica clients. A replica for each read query will be selected randomly:

```ts
const replicaClient1 = new PrismaClient({ adapter: replicaAdapter1 })
const replicaClient2 = new PrismaClient({ adapter: replicaAdapter2 })

const prisma = new PrismaClient({ adapter: mainAdapter }).$extends(
  readReplicas({
    replicas: [replicaClient1, replicaClient2],
  }),
)
```

All non-transactional read queries will now be executed against the defined replicas.  
Write queries and transactions will be executed against the primary server.

**Note**: `queryRaw` and `executeRaw` are always executed against the primary server by default since
the extension can not know for sure if a particular raw query would read or write to the database.
Use the `$replica()` method to explicitly route the request to a read replica.

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
  const replicaClient = new PrismaClient({ adapter: replicaAdapter })

  const prisma = new PrismaClient({ adapter: mainAdapter })
    .$extends(withAccelerate())
    .$extends(rlsExtension())
    .$extends(
      readReplicas({
        replicas: [replicaClient],
      }),
    )
  ```

- This extension requires Prisma 7.0+. Prisma 7 requires that PrismaClient instances are configured with either a driver adapter or an accelerateUrl.
