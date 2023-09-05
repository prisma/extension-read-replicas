/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
'use strict'
const assert = require('node:assert')
const { readReplicas } = require('..')

assert(typeof readReplicas === 'function')
