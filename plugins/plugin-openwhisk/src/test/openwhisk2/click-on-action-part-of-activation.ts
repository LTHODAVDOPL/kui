/*
 * Copyright 2017 IBM Corporation
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

/**
 * tests that create an action and test that it shows up in the list UI
 *    this test also covers toggling the sidecar
 */

import { Common, CLI, ReplExpect, SidecarExpect, Selectors } from '@kui-shell/test'

import * as openwhisk from '@kui-shell/plugin-openwhisk/tests/lib/openwhisk/openwhisk'

import { dirname } from 'path'

const ROOT = dirname(require.resolve('@kui-shell/plugin-openwhisk/tests/package.json'))

describe('Click on action part of activation sidecar', function(this: Common.ISuite) {
  before(openwhisk.before(this))
  after(Common.after(this))

  // create an action, using the implicit entity type
  it('should create an action', () =>
    CLI.command(`wsk action create foo ${ROOT}/data/openwhisk/foo.js`, this.app)
      .then(ReplExpect.justOK)
      .then(SidecarExpect.open)
      .then(SidecarExpect.showing('foo'))
      .catch(Common.oops(this)))

  // packaged action
  it('should create a package', () =>
    CLI.command(`wsk package create ppp`, this.app)
      .then(ReplExpect.justOK)
      .then(SidecarExpect.open)
      .then(SidecarExpect.showing('ppp'))
      .catch(Common.oops(this)))
  it('should create a package action', () =>
    CLI.command(`wsk action create ppp/foo ${ROOT}/data/openwhisk/foo.js`, this.app)
      .then(ReplExpect.justOK)
      .then(SidecarExpect.open)
      .then(SidecarExpect.showing('foo', undefined, false, 'ppp'))
      .catch(Common.oops(this)))

  // invoke it asynchronously with no params
  it('should async that action', () =>
    CLI.command(`wsk action async foo`, this.app)
      .then(ReplExpect.okWithCustom(CLI.makeCustom('.activationId', '')))
      .then(async selector => {
        const activationId = await this.app.client.getText(selector)
        await this.app.client.click(selector)
        return SidecarExpect.open(this.app).then(SidecarExpect.showing('foo', activationId))
      })
      .catch(Common.oops(this)))

  it('should click on name part of activation', () =>
    this.app.client
      .click(Selectors.SIDECAR_TITLE)
      .then(() => this.app)
      .then(SidecarExpect.showing('foo'))
      .catch(Common.oops(this)))

  // invoke it asynchronously with no params
  it('should async the packaged action', () =>
    CLI.command(`wsk action async ppp/foo`, this.app)
      .then(ReplExpect.okWithCustom(CLI.makeCustom('.activationId', '')))
      .then(async selector => {
        const activationId = await this.app.client.getText(selector)
        await this.app.client.click(selector)
        return SidecarExpect.open(this.app).then(SidecarExpect.showing('foo', activationId))
      })
      .catch(Common.oops(this)))

  // a bit of a race here

  it('should click on name part of activation', () =>
    this.app.client
      .click(Selectors.SIDECAR_TITLE)
      .then(() => this.app)
      .then(SidecarExpect.showing('foo', undefined, false, 'ppp'))
      .catch(Common.oops(this)))
})
