import { PrismaClient } from '@prisma/client/extension'

export type ReplicaManagerOptions = {
  replicas: PrismaClient[]
}

export class ReplicaManager {
  private _replicaClients: PrismaClient[]

  constructor(options: ReplicaManagerOptions) {
    this._replicaClients = options.replicas
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
