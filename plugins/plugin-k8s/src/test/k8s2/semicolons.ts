/*
 * Copyright 2019 IBM Corporation
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

import { Common, CLI, ReplExpect, SidecarExpect, Selectors } from '@kui-shell/test'
import {
  waitForGreen,
  defaultModeForGet,
  createNS,
  allocateNS,
  deleteNS
} from '@kui-shell/plugin-k8s/tests/lib/k8s/utils'

const synonyms = ['kubectl']
const dashFs = ['-f']

const echoString = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'

describe(`kubectl semicolons ${process.env.MOCHA_RUN_TARGET || ''}`, function(this: Common.ISuite) {
  before(Common.before(this))
  after(Common.after(this))

  // repeat the tests for kubectl, k, etc. i.e. any built-in
  // synonyms/aliases we have for "kubectl"
  synonyms.forEach(kubectl => {
    dashFs.forEach(dashF => {
      const ns: string = createNS()
      const inNamespace = `-n ${ns}`

      allocateNS(this, ns)

      it(`should create sample pod from URL via ${kubectl}`, async () => {
        try {
          const selector = await CLI.command(
            `${kubectl} create ${dashF} https://raw.githubusercontent.com/kubernetes/examples/master/staging/pod ${inNamespace}`,
            this.app
          ).then(ReplExpect.okWithCustom({ selector: Selectors.BY_NAME('nginx') }))

          // wait for the badge to become green
          await waitForGreen(this.app, selector)

          // now click on the table row
          await this.app.client.click(`${selector} .clickable`)
          await SidecarExpect.open(this.app)
            .then(SidecarExpect.mode(defaultModeForGet))
            .then(SidecarExpect.showing('nginx'))
        } catch (err) {
          await Common.oops(this, true)(err)
        }
      })

      it(`should get with semicolon 1`, () => {
        return CLI.command(`${kubectl} get pods -n ${ns}; echo ${echoString}`, this.app)
          .then(ReplExpect.okWithCustom({ selector: Selectors.BY_NAME('nginx') }))
          .then(selector => waitForGreen(this.app, selector))
          .catch(Common.oops(this, true))
      })

      it(`should get with semicolon 2`, () => {
        return CLI.command(`${kubectl} get pods -n ${ns} ; echo ${echoString}`, this.app)
          .then(ReplExpect.okWithCustom({ selector: Selectors.BY_NAME('nginx') }))
          .then(selector => waitForGreen(this.app, selector))
          .catch(Common.oops(this, true))
      })

      it(`should get with semicolon 3`, () => {
        return CLI.command(`${kubectl} get pods -n ${ns} ;echo ${echoString};`, this.app)
          .then(ReplExpect.okWithCustom({ selector: Selectors.BY_NAME('nginx') }))
          .then(selector => waitForGreen(this.app, selector))
          .catch(Common.oops(this, true))
      })

      it(`should get with semicolon 4`, () => {
        return CLI.command(`${kubectl} get pods -n ${ns} ;echo ${echoString}; ; ; ;;;`, this.app)
          .then(ReplExpect.okWithCustom({ selector: Selectors.BY_NAME('nginx') }))
          .then(selector => waitForGreen(this.app, selector))
          .catch(Common.oops(this, true))
      })

      it(`should get with semicolon 5`, () => {
        return CLI.command(`${kubectl} get pods -n ${ns} ;echo ${echoString}; ; ; ;;;`, this.app)
          .then(ReplExpect.okWithString(echoString))
          .catch(Common.oops(this, true))
      })

      deleteNS(this, ns)
    })
  })
})
