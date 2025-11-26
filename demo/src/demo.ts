import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client'
import { readReplicas } from '../../dist'

const mainAdapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
})

const replicaAdapter = new PrismaPg({
  connectionString: process.env.REPLICA_URL!,
})

const replicaClient = new PrismaClient({ adapter: replicaAdapter })

const client = new PrismaClient({ adapter: mainAdapter }).$extends(readReplicas({ replicas: [replicaClient] }))

async function main() {
  await client.user.deleteMany()
  await client.user.create({
    data: {
      email: 'user@example.com',
    },
  })

  console.log('from replica:', await client.user.findMany())
  console.log('from primary:', await client.$primary().user.findMany())

  const xclient1 = client.$extends({
    result: {
      user: {
        uppercaseMail: {
          needs: { email: true },
          compute({ email }) {
            return email.toUpperCase()
          },
        },
      },
    },
  })

  console.log('replica with result extension:', await xclient1.user.findFirstOrThrow())
  console.log('primary with result extension:', await xclient1.$primary().user.findFirstOrThrow())

  await replicaClient.$disconnect()
  await client.$disconnect()
}

main()
