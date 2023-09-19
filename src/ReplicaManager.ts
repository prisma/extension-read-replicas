import { PrismaClient } from '@prisma/client/extension'

type PrismaConstructorOptions = {
  datasourceUrl?: string
}

export type ConfigureReplicaCallback = (client: PrismaClient) => PrismaClient
interface PrismaClientConstructor {
  new (options?: PrismaConstructorOptions): PrismaClient
}

type ReplicaManagerOptions = {
  clientConstructor: PrismaClientConstructor
  replicaUrls: string[]
  configureCallback: ConfigureReplicaCallback | undefined
}

export class ReplicaManager {
  private _replicaClients: PrismaClient[]

  constructor({ replicaUrls, clientConstructor, configureCallback }: ReplicaManagerOptions) {
    this._replicaClients = replicaUrls.map((datasourceUrl) => {
      const client = new clientConstructor({
        datasourceUrl,
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

  pickReplica(): PrismaClient | undefined {
    return this._replicaClients[Math.floor(Math.random() * this._replicaClients.length)]
  }
}
