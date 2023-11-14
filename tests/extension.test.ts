import execa from 'execa'
// @ts-ignore
import { readReplicas } from '..'
import type { PrismaClient } from './client'

type LogEntry = { server: 'primary' | 'replica'; operation: string }

let logs: LogEntry[]
function createPrisma() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const clientModule = require('./client')
  const basePrisma = new clientModule.PrismaClient() as PrismaClient

  const prisma = basePrisma
    .$extends(
      readReplicas(
        {
          url: process.env.REPLICA_URL!,
        },
        (client) =>
          (client as PrismaClient).$extends({
            query: {
              $allOperations({ args, operation, query }) {
                logs.push({ server: 'replica', operation })
                return query(args)
              },
            },
          }),
      ),
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

let basePrisma: ReturnType<typeof createPrisma>
let prisma: ReturnType<typeof createPrisma>

beforeAll(async () => {
  await execa('pnpm', ['prisma', 'db', 'push', '--schema', 'tests/prisma/schema.prisma'], {
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
        url: [],
      }),
    )

  expect(createInstance).toThrowError('At least one replica URL must be specified')
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
  await prisma.$transaction(async (tx) => {
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
  const prisma = basePrisma.$extends(
    readReplicas(
      {
        url: process.env.REPLICA_URL!,
        replicaClientOptions: {
          log: [{ emit: 'event', level: 'query' }],
        },
      },
      (client) => {
        client.$on('query', () => {
          logs.push({ server: 'replica', operation: 'replica logger' })
          resolve('logged')
        })
        return client
      },
    ),
  )

  await prisma.user.findMany()
  await promise
  expect(logs).toEqual([
    {
      operation: `replica logger`,
      server: 'replica',
    },
  ])
})

afterAll(async () => {
  await prisma.$disconnect()
})
