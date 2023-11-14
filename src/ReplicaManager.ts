import { PrismaClient } from '@prisma/client/extension'
import { PrismaClientOptions } from '@prisma/client/runtime/library'

export type ConfigureReplicaCallback = (client: PrismaClient) => PrismaClient
interface PrismaClientConstructor {
  new (options?: PrismaClientOptions): PrismaClient
}

type ReplicaManagerOptions = {
  clientConstructor: PrismaClientConstructor
  replicaUrls: string[]
  replicaClientOptions?: PrismaClientOptions
  configureCallback: ConfigureReplicaCallback | undefined
}

export class ReplicaManager {
  private _replicaClients: PrismaClient[]

  constructor({ replicaUrls, replicaClientOptions, clientConstructor, configureCallback }: ReplicaManagerOptions) {
    this._replicaClients = replicaUrls.map((datasourceUrl) => {
      const client = new clientConstructor({
        datasourceUrl,
        ...replicaClientOptions,
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
