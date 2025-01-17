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

import { Common, CLI, ReplExpect, Selectors } from '@kui-shell/test'
import { createNS, waitForGreen, waitForRed } from '@kui-shell/plugin-k8s/tests/lib/k8s/utils'

describe(`kubectl watch error handler ${process.env.MOCHA_RUN_TARGET}`, function(this: Common.ISuite) {
  before(Common.before(this))
  after(Common.after(this))

  const testResourceNotFound = (watchCmd: string, resourceType: string, resourceName: string) => {
    const errorMessage = `Error from server (NotFound): ${resourceType} "${resourceName}" not found`

    it(`should error out when watching a non-existent ${resourceType}`, () => {
      return CLI.command(watchCmd, this.app)
        .then(ReplExpect.error(404, errorMessage))
        .catch(Common.oops(this))
    })
  }

  const testWrongCommand = (watchCmd: string, code: number, errMessage?: string) => {
    it(`should error out with wrong command ${watchCmd}`, () => {
      return CLI.command(watchCmd, this.app)
        .then(errMessage ? ReplExpect.error(code, errMessage) : ReplExpect.error(code))
        .catch(Common.oops(this))
    })
  }

  // here comes the tests that expect failure due to non-existant resources
  const flags = ['-w', '--watch=true', '-w -w -w']
  flags.forEach(watch => {
    testResourceNotFound(`k get ns shouldNotExist ${watch}`, 'namespaces', 'shouldNotExist')
    testResourceNotFound(`k get ns ${watch} shouldNotExist`, 'namespaces', 'shouldNotExist')

    testResourceNotFound(`k get pod shouldNotExist ${watch}`, 'pods', 'shouldNotExist')
    testResourceNotFound(`k get ${watch} pod shouldNotExist`, 'pods', 'shouldNotExist')

    testResourceNotFound(`k get pods shouldNotExist -n shouldNotExist ${watch}`, 'namespaces', 'shouldNotExist')
  })

  // here comes the tests that expect failure due to wrong flag
  const wrongFlags = ['--watch true', '-w true']
  wrongFlags.forEach(watch => {
    testResourceNotFound(`k get pod ${watch}`, 'pods', 'true') // the command is parsed as `kubectl get pod true`
    testWrongCommand(`k get ${watch} pod`, 404, 'error: the server doesn\'t have a resource type "true"') // the command is parsed as `kubectl get true pod`
  })

  testWrongCommand(`k -w get pod`, 500)

  // here comes the tests should start watching successfully
  it(`should watch pods, starting from an non-existant namespace`, async () => {
    try {
      const ns = createNS()

      // start to watch pods in a non-existant namespace
      const watchResult = await CLI.command(`k get pods -w -n ${ns}`, this.app).then(async result => {
        await ReplExpect.ok(result)
        return result
      })

      // create the namespace
      await CLI.command(`k create ns ${ns}`, this.app)
        .then(ReplExpect.okWithCustom({ selector: Selectors.BY_NAME(ns) }))
        .then(status => waitForGreen(this.app, status))

      // create a pod
      await CLI.command(
        `k create -f https://raw.githubusercontent.com/kubernetes/examples/master/staging/pod -n ${ns}`,
        this.app
      )
        .then(ReplExpect.okWithCustom({ selector: Selectors.BY_NAME('nginx') }))
        .then(status => waitForGreen(this.app, status))

      // the watch table should have the new pods with online status
      const watchStatus = `${Selectors.OUTPUT_N(watchResult.count)} ${Selectors.BY_NAME('nginx')}`
      await this.app.client.waitForExist(watchStatus)
      await waitForGreen(this.app, watchStatus)

      // delete the pod
      await CLI.command(`k delete pods nginx -n ${ns}`, this.app)
        .then(ReplExpect.okWithCustom({ selector: Selectors.BY_NAME('nginx') }))
        .then(status => waitForRed(this.app, status))

      // the watch table should have the new pods with offline status
      await waitForRed(this.app, watchStatus)

      // delete the namespace
      await CLI.command(`k delete ns ${ns}`, this.app)
        .then(ReplExpect.okWithCustom({ selector: Selectors.BY_NAME(ns) }))
        .then(nsStatus => waitForRed(this.app, nsStatus))
    } catch (err) {
      await Common.oops(this, true)(err)
    }
  })
})
