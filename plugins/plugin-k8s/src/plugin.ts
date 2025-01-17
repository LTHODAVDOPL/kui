/*
 * Copyright 2018 IBM Corporation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Debug from 'debug'
const debug = Debug('k8s/loader')
debug('loading')

import auth from './lib/controller/auth'
import contexts from './lib/controller/contexts'
import kubectl from './lib/controller/kubectl'
import status from './lib/controller/status'

import Capabilities from '@kui-shell/core/api/capabilities'
import Commands from '@kui-shell/core/api/commands'

export default async (commandTree: Commands.Registrar) => {
  return Promise.all([
    auth(commandTree),
    contexts(commandTree),
    status(commandTree),
    kubectl(commandTree),
    Capabilities.inBrowser() ? Promise.resolve() : (await import('./lib/controller/kedit')).default(commandTree)
  ])
}
