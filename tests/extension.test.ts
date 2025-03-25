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
          defaultReadClient: 'replica',
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

  const prismaDefaultPrimary = basePrisma
    .$extends(
      readReplicas(
        {
          url: process.env.REPLICA_URL!,
          defaultReadClient: 'primary',
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

  return [basePrisma, prisma, prismaDefaultPrimary] as const
}

let basePrisma: ReturnType<typeof createPrisma>
let prisma: ReturnType<typeof createPrisma>
let prismaDefaultPrimary: ReturnType<typeof createPrisma>

beforeAll(async () => {
  await execa('pnpm', ['prisma', 'db', 'push', '--schema', 'tests/prisma/schema.prisma'], {
    cwd: __dirname,
  })
  ;[basePrisma, prisma, prismaDefaultPrimary] = createPrisma()
})

beforeEach(async () => {
  logs = []
})

test('client throws an error when given an empty read replica url list', async () => {
  const createInstance = () =>
    basePrisma.$extends(
      readReplicas({
        url: [],
      }),
    )

  expect(createInstance).toThrowError('At least one replica URL must be specified')
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

test('client throws an error when given both a URL and a list of replicas', async () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const clientModule = require('./client')
  const replicaPrisma = new clientModule.PrismaClient({
    datasourceUrl: process.env.REPLICA_URL!,
    log: [{ emit: 'event', level: 'query' }],
  })
  const createInstance = () =>
    basePrisma.$extends(
      readReplicas({
        url: process.env.REPLICA_URL!,
        replicas: [replicaPrisma],
      }),
    )

  expect(createInstance).toThrowError(`Only one of 'url' or 'replicas' can be specified`)
})

test('client throws an error when given an invalid read replicas options', async () => {
  const createInstance = () =>
    basePrisma.$extends(
      readReplicas({
        // @ts-expect-error
        foo: 'bar',
      }),
    )

  expect(createInstance).toThrowError('Invalid read replicas options')
})

test('read query is executed against replica', async () => {
  await prisma.user.findMany()

  expect(logs).toEqual([{ server: 'replica', operation: 'findMany' }])
})

test('read query is executed against primary if defaultReadClient is set to primary', async () => {
  await prismaDefaultPrimary.user.findMany()

  expect(logs).toEqual([{ server: 'primary', operation: 'findMany' }])
})

test('read query is executed against replica if $replica() is used', async () => {
  await prisma.$replica().user.findMany()

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
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const clientModule = require('./client')
  const replicaPrisma = new clientModule.PrismaClient({
    datasourceUrl: process.env.REPLICA_URL!,
    log: [{ emit: 'event', level: 'query' }],
  })

  replicaPrisma.$on('query', () => {
    logs.push({ server: 'replica', operation: 'replica logger' })
    resolve('logged')
  })

  const prisma = basePrisma.$extends(
    readReplicas({
      replicas: [replicaPrisma],
    }),
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
