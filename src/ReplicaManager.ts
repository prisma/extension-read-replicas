import { PrismaClient } from '@prisma/client/extension'

type PrismaConstructorOptions = {
  datasources?: Record<string, { url: string }>
}

export type ConfigureReplicaCallback = (client: PrismaClient) => PrismaClient
interface PrismaClientConstructor {
  new (options?: PrismaConstructorOptions): PrismaClient
}

type ReplicaManagerOptions = {
  clientConstructor: PrismaClientConstructor
  replicaUrls: string[]
  datasourceName: string
  configureCallback: ConfigureReplicaCallback | undefined
}

export class ReplicaManager {
  private _replicaClients: PrismaClient[]

  constructor({ replicaUrls, datasourceName, clientConstructor, configureCallback }: ReplicaManagerOptions) {
    this._replicaClients = replicaUrls.map((url) => {
      const client = new clientConstructor({
        datasources: {
          [datasourceName]: {
            url,
          },
        },
      })

      if (configureCallback) {
        return configureCallback(client)
      }
      return client
    })
  }

  async connectAll() {
    await Promise.all(this._replicaClients.map((client) => client.$connect()))
  }

  async disconnectAll() {
    await Promise.all(this._replicaClients.map((client) => client.$disconnect()))
  }

  pickReplica(): PrismaClient {
    return this._replicaClients[Math.floor(Math.random() * this._replicaClients.length)]
  }
}
