import { readReplicas } from '@prisma/extension-read-replicas'
import assert from 'node:assert'

assert(typeof readReplicas === 'function')
