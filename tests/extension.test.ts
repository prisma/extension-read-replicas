import execa from 'execa'
import { PrismaPg } from '@prisma/adapter-pg'
// @ts-ignore
import { readReplicas } from '..'
import type { PrismaClient } from './generated/prisma'

type LogEntry = { server: 'primary' | 'replica'; operation: string }

let logs: LogEntry[]
let replicaClients: PrismaClient[] = []

function createPrisma() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const clientModule = require('./generated/prisma')

  // Create adapters for Prisma 7
  const mainAdapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  })
  const replicaAdapter = new PrismaPg({
    connectionString: process.env.REPLICA_URL!,
  })

  const basePrisma = new clientModule.PrismaClient({ adapter: mainAdapter }) as PrismaClient

  // Create replica client with Prisma 7 configuration
  const replicaClient = new clientModule.PrismaClient({
    adapter: replicaAdapter,
  }) as PrismaClient

  // Track replica clients for cleanup
  replicaClients.push(replicaClient)

  const replicaClientWithLogging = replicaClient.$extends({
    query: {
      $allOperations({ args, operation, query }) {
        logs.push({ server: 'replica', operation })
        return query(args)
      },
    },
  })

  const prisma = basePrisma
    .$extends(
      readReplicas({
        replicas: [replicaClientWithLogging],
      }),
    )
    .$extends({
      query: {
        $allOperations({ args, operation, query }) {
          logs.push({ server: 'primary', operation })
          return query(args)
        },
      },
    })

  return [basePrisma, prisma] as const
}

let basePrisma: PrismaClient
let prisma: ReturnType<typeof createPrisma>[1]

beforeAll(async () => {
  await execa('pnpm', ['prisma', 'db', 'push'], {
    cwd: __dirname,
  })
  await execa('pnpm', ['prisma', 'generate'], {
    cwd: __dirname,
  })
  ;[basePrisma, prisma] = createPrisma()
})

beforeEach(async () => {
  logs = []
})

test('client throws an error when given an empty read replica list', async () => {
  const createInstance = () =>
    basePrisma.$extends(
      readReplicas({
        replicas: [],
      }),
    )

  expect(createInstance).toThrowError('At least one replica must be specified')
})

test('read query is executed against replica', async () => {
  await prisma.user.findMany()

  expect(logs).toEqual([{ server: 'replica', operation: 'findMany' }])
})

test('write query is executed against primary', async () => {
  await prisma.user.updateMany({ data: {} })

  expect(logs).toEqual([{ server: 'primary', operation: 'updateMany' }])
})

test('$executeRaw and $executeRawUnsafe are executed against primary', async () => {
  await prisma.$executeRaw`SELECT 1;`
  await prisma.$executeRawUnsafe('SELECT $1 as id;', 1)

  expect(logs).toEqual([
    { server: 'primary', operation: '$executeRaw' },
    { server: 'primary', operation: '$executeRawUnsafe' },
  ])
})

test('$executeRaw and $executeRawUnsafe are executed against replica if $replica() is used', async () => {
  await prisma.$replica().$executeRaw`SELECT 1;`
  await prisma.$replica().$executeRawUnsafe('SELECT $1 as id;', 1)

  expect(logs).toEqual([
    { server: 'replica', operation: '$executeRaw' },
    { server: 'replica', operation: '$executeRawUnsafe' },
  ])
})

test('read query is executed against primary if $primary() is used', async () => {
  await prisma.$primary().user.findMany()

  // extension exits before calling further ones (including logging), hence, the logs
  // will be empty in this case
  expect(logs).toEqual([])
})

test('transactional queries are executed against primary (sequential)', async () => {
  await prisma.$transaction([prisma.user.findMany(), prisma.user.updateMany({ data: {} })])
  expect(logs).toEqual([
    { server: 'primary', operation: 'findMany' },
    { server: 'primary', operation: 'updateMany' },
  ])
})

test('transactional queries are executed against primary (itx)', async () => {
  await prisma.$transaction(async (tx: any) => {
    await tx.user.findMany()
    await tx.user.updateMany({ data: {} })
  })
  expect(logs).toEqual([
    { server: 'primary', operation: 'findMany' },
    { server: 'primary', operation: 'updateMany' },
  ])
})

test('replica client with options', async () => {
  let resolve: (value: unknown) => void
  const promise = new Promise((res) => {
    resolve = res
  })
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const clientModule = require('./generated/prisma')
  const replicaAdapter = new PrismaPg({
    connectionString: process.env.REPLICA_URL!,
  })
  const replicaPrisma = new clientModule.PrismaClient({
    adapter: replicaAdapter,
    log: [{ emit: 'event', level: 'query' }],
  }) as PrismaClient

  // Track this replica client for cleanup
  replicaClients.push(replicaPrisma)
  ;(replicaPrisma as any).$on('query', () => {
    logs.push({ server: 'replica', operation: 'replica logger' })
    resolve('logged')
  })

  const testPrisma = basePrisma.$extends(
    readReplicas({
      replicas: [replicaPrisma],
    }),
  )

  await testPrisma.user.findMany()
  await promise
  expect(logs).toEqual([
    {
      operation: `replica logger`,
      server: 'replica',
    },
  ])

  // Clean up the test client (this will also disconnect replicaPrisma via the extension)
  await testPrisma.$disconnect()
  // Remove from tracking since it's already disconnected
  replicaClients = replicaClients.filter((client) => client !== replicaPrisma)
})

afterAll(async () => {
  // Disconnect main extended client first (this will disconnect its replicas via the extension)
  await prisma.$disconnect()
  // Disconnect base client
  await basePrisma.$disconnect()
  // Disconnect any remaining standalone replica clients (shouldn't be any, but just in case)
  await Promise.all(replicaClients.map((client) => client.$disconnect().catch(() => {})))
})
