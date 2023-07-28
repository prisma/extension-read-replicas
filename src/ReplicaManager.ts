import { PrismaClient } from '@prisma/client/extension'

type PrismaConstructorOptions = {
  datasources?: Record<string, { url: string }>
}
interface PrismaClientConstructor {
  new (options?: PrismaConstructorOptions): typeof PrismaClient
}

type ReplicaManagerOptions = {
  clientConstructor: PrismaClientConstructor
  replicaUrls: string[]
  datasourceName: string
}

export class ReplicaManager {
  private _replicaClients: PrismaClient[]

  constructor({ replicaUrls, datasourceName, clientConstructor }: ReplicaManagerOptions) {
    this._replicaClients = replicaUrls.map(
      (url) =>
        new clientConstructor({
          datasources: {
            [datasourceName]: {
              url,
            },
          },
        }),
    )
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
