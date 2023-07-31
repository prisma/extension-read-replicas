# read-replicas-extension

## Requirements

Works best with Prisma 5.1+. Can work with earlier versions (4.16.2+) if [no result extensions](https://www.prisma.io/docs/concepts/components/prisma-client/client-extensions/result) are used at the same time.

## Usage

### Initialization

```ts
import { PrismaClient } from '@prisma/client'
import { readReplicas } from '@prisma/read-replicas-extension'

const prisma = new PrismaClient().$extends({
  db: 'postgresql://replica.example.com:5432/db',
})
```

Where `db` is the name of your datasource (`datasource` block in the schema file).

All non-transactional read queries now will be executed against the replica. Write queries and transactions would be executed against the primary server.

### Multiple replicas

You can also initialize the extension with an array of replica urls:

```ts
const prisma = new PrismaClient().$extends({
  db: [
    'postgresql://replica-1.example.com:5432/db',
    'postgresql://replica-2.example.com:5432/db',
  ],
})
```

In this case, replica for each read query will be selected randomly.

### Bypassing the replicas

If you want to execute read query against the primary server, you can use `$primary()` method on extended client:

```ts
prisma.$primary().user.findMany({ where: { ... }})
```

### Caveats and limitations

At the moment, if you are using replicas extension alongside other extensions, replicas should be applied last:

```ts
const prisma = new PrismaClient()
  .$extends(withAccelerate())
  .$extends(rlsExtension())
  .$extends({
    db: 'postgresql://replica.example.com:5432/db',
  })
```

If you are using replicas extension with Prisma version below 5.1, result extensions will not work.
