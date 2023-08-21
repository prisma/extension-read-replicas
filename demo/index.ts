import { PrismaClient } from '@prisma/client'
import { readReplicas } from '..'

const client = new PrismaClient().$extends(readReplicas({ url: process.env.REPLICA_URL! }))

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
}

main()
