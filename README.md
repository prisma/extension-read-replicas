# @prisma/extension-read-replicas

This [Prisma Client Extension](https://www.prisma.io/docs/concepts/components/prisma-client/client-extensions) adds read replica support to your Prisma Client.

## Requirements

Works best with Prisma 5.1+. Can work with earlier versions (4.16.2+) if [no result extensions](https://www.prisma.io/docs/concepts/components/prisma-client/client-extensions/result) are used at the same time.

## Usage

### Initialization

```ts
import { PrismaClient } from '@prisma/client'
import { readReplicas } from '@prisma/read-replicas-extension'

const prisma = new PrismaClient().$extends(
  readReplicas({
    db: 'postgresql://replica.example.com:5432/db',
  }),
)
```

Where `db` is the name of your datasource (`datasource` block in the schema file).

All non-transactional read queries will now be executed against the defined replica.  
Write queries and transactions will be executed against the primary server.

### Multiple replicas

You can also initialize the extension with an array of replica connection strings:

```ts
const prisma = new PrismaClient().$extends(
  readReplicas({
    db: [
      'postgresql://replica-1.example.com:5432/db',
      'postgresql://replica-2.example.com:5432/db',
    ],
  }),
)
```

In this case, a replica for each read query will be selected randomly.

### Bypassing the replicas

If you want to execute a read query against the primary server, you can use the `$primary()` method on your extended client:

```ts
prisma.$primary().user.findMany({ where: { ... }})
```

### Caveats and limitations

At the moment, if you are using this read replicas extension alongside other extensions, this extension should be applied last:

```ts
const prisma = new PrismaClient()
  .$extends(withAccelerate())
  .$extends(rlsExtension())
  .$extends(
    readReplicas({
      db: 'postgresql://replica.example.com:5432/db',
    }),
  )
```

If you are using the read replicas extension with Prisma version below 5.1, any result extensions will not work.
