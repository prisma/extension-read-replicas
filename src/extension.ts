import { Prisma, PrismaClient } from '@prisma/client/extension.js'

import { ConfigureReplicaCallback, ReplicaManager, type ReplicaManagerOptions } from './ReplicaManager'

export type ReplicasOptions =
  | {
      url: string | string[]
      replicas?: undefined
    }
  | { url?: undefined; replicas: PrismaClient[] }

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
    const PrismaClient = Object.getPrototypeOf(Reflect.get(client, '_originalClient')).constructor
    const datasourceName = Object.keys(options).find((key) => !key.startsWith('$'))
    if (!datasourceName) {
      throw new Error(`Read replicas options must specify a datasource`)
    }

    if ('url' in options && 'replicas' in options) {
      throw new Error(`Only one of 'url' or 'replicas' can be specified`)
    }

    let replicaManagerOptions: ReplicaManagerOptions

    if (options.url) {
      let replicaUrls = options.url

      if (typeof replicaUrls === 'string') {
        replicaUrls = [replicaUrls]
      } else if (replicaUrls && !Array.isArray(replicaUrls)) {
        throw new Error(`Replica URLs must be a string or list of strings`)
      }

      if (replicaUrls?.length === 0) {
        throw new Error(`At least one replica URL must be specified`)
      }

      replicaManagerOptions = {
        replicaUrls: replicaUrls,
        clientConstructor: PrismaClient,
        configureCallback: configureReplicaClient,
      }
    } else if (options.replicas) {
      if (options.replicas.length === 0) {
        throw new Error(`At least one replica must be specified`)
      }
      replicaManagerOptions = {
        replicas: options.replicas,
      }
    } else {
      throw new Error(`Invalid read replicas options`)
    }

    const replicaManager = new ReplicaManager(replicaManagerOptions)

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
        async $allOperations({
          args,
          model,
          operation,
          query,
          // @ts-expect-error We make use of internal APIs to make this extension work.
          __internalParams: { transaction, dataPath },
        }) {
          if (transaction) {
            return query(args)
          }
          if (readOperations.includes(operation)) {
            const replica = replicaManager.pickReplica()

            if (model) {
              let result = await replica[model][operation](args)

              // HACK: Work around lack of read replica support by leveraging
              // dataPath. We expect dataPath to be in the following format:
              // [ 'select', 'fieldNameOne', 'select', 'fieldNameTwo' ]
              // Given this format, we'll read every second string to get the
              // expected response type.
              const path = dataPath as string[]
              for (let i = 1; i < path.length; i += 2) {
                if (Array.isArray(result)) {
                  result = result.flatMap((item) => item?.[path[i]])
                } else {
                  result = result?.[path[i]]
                }
              }

              return result
            }

            return replica[operation](args)
          }

          return query(args)
        },
      },
    })
  })
