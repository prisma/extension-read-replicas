import { debug as createDebug } from 'debug'
import { Prisma } from '@prisma/client/extension'

import { ReplicaManager } from './ReplicaManager'

export type ReplicasOptions = {
  [datasource: string]: string | string[]
}
const debug = createDebug('prisma:replicasExtension')

const readOperations = [
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'groupBy',
  'aggregate',
  'count',
  'queryRaw',
  'queryRawUnsafe',
  'findRaw',
  'aggregateRaw',
]

export const readReplicas = (options: ReplicasOptions) =>
  Prisma.defineExtension((client) => {
    const PrismaClient = Object.getPrototypeOf(client).constructor
    const datasourceName = Object.keys(options)[0]
    if (!datasourceName) {
      throw new Error(`Read replicas options must specify a datasource`)
    }
    let urls = options[datasourceName]
    if (typeof urls === 'string') {
      urls = [urls]
    } else if (!Array.isArray(urls)) {
      throw new Error(`Replica URLs must be a string or list of strings`)
    }

    const replicaManager = new ReplicaManager({
      replicaUrls: urls,
      clientConstructor: PrismaClient,
      datasourceName,
    })

    return client.$extends({
      client: {
        $primary<T>(this: T): Omit<T, '$primary'> {
          return client as unknown as Omit<T, '$primary'>
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
            debug('transactional query, using primary instance')
            return query(args)
          }
          if (readOperations.includes(operation)) {
            debug(`read operation ${operation} on model ${model}, using replica`)
            const replica = replicaManager.pickReplica()
            if (model) {
              return replica[model][operation](args)
            }
            return replica[operation](args)
          }

          debug(`write operation ${operation} on model ${model}, using primary instance`)
          return query(args)
        },
      },
    })
  })
