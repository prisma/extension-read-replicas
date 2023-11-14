import { Prisma } from '@prisma/client/extension.js'

import { ConfigureReplicaCallback, ReplicaManager } from './ReplicaManager'
import { PrismaClientOptions } from '@prisma/client/runtime/library'

export type ReplicasOptions = {
  url: string | string[]
  replicaClientOptions?: PrismaClientOptions
}

const readOperations = [
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'groupBy',
  'aggregate',
  'count',
  'findRaw',
  'aggregateRaw',
]

export const readReplicas = (options: ReplicasOptions, configureReplicaClient?: ConfigureReplicaCallback) =>
  Prisma.defineExtension((client) => {
    const PrismaClient = Object.getPrototypeOf(client).constructor
    const datasourceName = Object.keys(options).find((key) => !key.startsWith('$'))
    if (!datasourceName) {
      throw new Error(`Read replicas options must specify a datasource`)
    }
    let replicaUrls = options.url
    if (typeof replicaUrls === 'string') {
      replicaUrls = [replicaUrls]
    } else if (!Array.isArray(replicaUrls)) {
      throw new Error(`Replica URLs must be a string or list of strings`)
    } else if (replicaUrls.length === 0) {
      throw new Error(`At least one replica URL must be specified`)
    }

    const replicaManager = new ReplicaManager({
      replicaUrls,
      clientConstructor: PrismaClient,
      replicaClientOptions: options.replicaClientOptions,
      configureCallback: configureReplicaClient,
    })

    return client.$extends({
      client: {
        $primary<T extends object>(this: T): Omit<T, '$primary' | '$replica'> {
          const context = Prisma.getExtensionContext(this)
          // If we're in a transaction, the current client is connected to the
          // primary.
          if (!('$transaction' in context && typeof context.$transaction === 'function')) {
            return context
          }

          return client as unknown as Omit<T, '$primary' | '$replica'>
        },

        $replica<T extends object>(this: T): Omit<T, '$primary' | '$replica'> {
          const context = Prisma.getExtensionContext(this)
          // If we're in a transaction, the current client is connected to the
          // primary.
          if (!('$transaction' in context && typeof context.$transaction === 'function')) {
            throw new Error(`Cannot use $replica inside of a transaction`)
          }

          return replicaManager.pickReplica() as unknown as Omit<T, '$primary' | '$replica'>
        },

        async $connect() {
          await Promise.all([(client as any).$connect(), replicaManager.connectAll()])
        },

        async $disconnect() {
          await Promise.all([(client as any).$disconnect(), replicaManager.disconnectAll()])
        },
      },

      query: {
        $allOperations({
          args,
          model,
          operation,
          query,
          // @ts-expect-error
          __internalParams: { transaction },
        }) {
          if (transaction) {
            return query(args)
          }
          if (readOperations.includes(operation)) {
            const replica = replicaManager.pickReplica()
            if (model) {
              return replica[model][operation](args)
            }
            return replica[operation](args)
          }

          return query(args)
        },
      },
    })
  })
