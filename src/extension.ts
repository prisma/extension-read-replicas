import { Prisma, PrismaClient } from '@prisma/client/extension.js'

import { ReplicaManager } from './ReplicaManager'

export type ReplicasOptions = {
  replicas: PrismaClient[]
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

export const readReplicas = (options: ReplicasOptions) =>
  Prisma.defineExtension((client) => {
    if (!options.replicas || options.replicas.length === 0) {
      throw new Error(`At least one replica must be specified`)
    }

    const replicaManager = new ReplicaManager({
      replicas: options.replicas,
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
