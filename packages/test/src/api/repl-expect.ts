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

import { Application } from 'spectron'
import * as assert from 'assert'

import { getTextContent, waitTimeout } from './cli'
import * as Selectors from './selectors'

export interface AppAndCount {
  app: Application
  count: number
}

interface CustomSpec {
  selector?: string
  errOk?: boolean
  expect?: string
  exact?: boolean
  passthrough?: boolean
}

interface Options {
  elements?: boolean
  expectError?: boolean
  exact?: boolean
  expect?: string
  nonBlankPromptOk?: boolean
  passthrough?: boolean
  selector?: string
  expectJustOK?: boolean
  expectString?: string
  expectArray?: string[]
}

const expectOK = (appAndCount: AppAndCount, opt?: Options) => {
  // appAndCount.count is the prompt index of this command... so +1 gives us the next prompt, whose existence signals that this command has finished
  const app = appAndCount.app
  const N = appAndCount.count + 1

  return app.client
    .waitForVisible(Selectors.PROMPT_N(N), waitTimeout) // wait for the next prompt to appear
    .then(() => app.client.getAttribute(Selectors.PROMPT_N(N), 'placeholder')) // it should have a placeholder text
    .then(() => app.client.getValue(Selectors.PROMPT_N(N))) // it should have an empty value
    .then(promptValue => {
      if ((!opt || !opt.nonBlankPromptOk) && promptValue.length !== 0) {
        console.error(`Expected prompt value to be empty: ${promptValue}`)
      }
      return promptValue
    })
    .then(promptValue => {
      if (!opt || !opt.nonBlankPromptOk) assert.strictEqual(promptValue.length, 0)
    }) //      ... verify that
    .then(async () => {
      if (opt && opt.expectError) return false
      const html = await app.client.getHTML(Selectors.OK_N(N - 1))
      const okReg = new RegExp(process.env.OK) || /ok/
      assert.ok(okReg.test(html)) // make sure it says "ok" !
    })
    .then(() => {
      // validate any expected list entry
      if (opt && opt.expectString) {
        // expect exactly one entry
        return app.client
          .getText(Selectors.LIST_RESULTS_BY_NAME_N(N - 1))
          .then(name => assert.strictEqual(name, opt.expectString))
      } else if (opt && opt.expectArray) {
        // expect several entries, of which opt is one // NOTE: what does it mean by opt is one???
        return app.client
          .getText(Selectors.LIST_RESULTS_BY_NAME_N(N - 1))
          .then(name => (!Array.isArray(name) ? [name] : name))
          .then(name => assert.ok(name !== opt.expectArray[0] && name.find(_ => _.indexOf(opt.expectArray[0]) >= 0)))
      } else if (opt && (opt.selector || opt.expect)) {
        // more custom, look for expect text under given selector
        const selector = `${Selectors.OUTPUT_N(N - 1)} ${opt.selector || ''}`
        if (opt.elements) {
          return app.client.elements(selector)
        } else {
          return app.client.getText(selector).then(txt => {
            if (opt.exact) assert.strictEqual(txt, opt.expect)
            else if (opt.expect) {
              if (txt.indexOf(opt.expect) < 0) {
                console.error(
                  `Expected string not found expected=${opt.expect} idx=${txt.indexOf(opt.expect)} actual=${txt}`
                )
                assert.ok(txt.indexOf(opt.expect) >= 0)
              }
            }

            return opt.passthrough ? N - 1 : selector // so that the caller can inspect the selector in more detail
          })
        }
      } else if (opt && opt.expectJustOK === true) {
        // ensure that there is nothing other than "ok"
        return app.client.waitUntil(async () => {
          const txt = await app.client.getText(Selectors.OUTPUT_N(N - 1))
          const justOK = process.env.OK || 'ok'
          return txt.length === 0 || txt === justOK
        })
      } else {
        // nothing to validate with the "console" results of the command
        // return the index of the last executed command
        return N - 1
      }
    })
    .then(res => (opt && (opt.selector || opt.passthrough) ? res : app)) // return res rather than app, if requested
}

export const ok = async (res: AppAndCount) =>
  expectOK(res, { passthrough: true })
    .then(N => res.app.client.elements(Selectors.LIST_RESULTS_BY_NAME_N(N)))
    .then(elts => assert.strictEqual(elts.value.length, 0))
    .then(() => res.app)

export const error = (statusCode: number | string, expect?: string) => async (res: AppAndCount) =>
  expectOK(res, {
    selector: `.oops[data-status-code="${statusCode || 0}"]`,
    expectError: true,
    expect: expect
  }).then(() => res.app)

export const errorWithPassthrough = (statusCode: number | string, expect?: string) => async (res: AppAndCount) =>
  expectOK(res, {
    selector: `.oops[data-status-code="${statusCode || 0}"]`,
    expectError: true,
    expect: expect,
    passthrough: true
  })

export const blankWithOpts = (opts = {}) => async (res: AppAndCount) =>
  expectOK(res, Object.assign({ selector: '', expectError: true }, opts))

export const blank = (res: AppAndCount) => blankWithOpts()(res)

/** The return type `any` comes from webdriverio waitUntil */
export const consoleToBeClear = (app: Application) => {
  return app.client.waitUntil(async () => {
    return app.client.elements(Selectors.PROMPT_BLOCK).then(elements => elements.value.length === 1)
  })
}

/** as long as its ok, accept anything */
export const okWithCustom = (custom: CustomSpec) => async (res: AppAndCount) => expectOK(res, custom)

export const okWithTextContent = (expect: string, exact = false, failFast = true, sel = ' ') => async (
  res: AppAndCount
) => {
  // Notes: webdriverio's getText seems to use .innerText to extract
  // the text from a given selector; this is quite unreliable in
  // terms of whitespace preservation; e.g. <div><span>
  // </span><span> </span></div> will preserve whitespace, but if
  // the inner spans have are inline-block, then innerText will not
  // preserve whitespace; textContent *will* preserve whitespace
  const selector = await okWithCustom({ selector: sel })(res)
  const txt = await getTextContent(res.app, selector)

  if (exact) {
    assert.strictEqual(txt, expect)
    return true
  } else {
    if (txt.indexOf(expect) < 0) {
      console.error(`Expected string not found expected=${expect} idx=${txt.indexOf(expect)} actual=${txt}`)
      if (failFast) {
        assert.ok(txt.indexOf(expect) >= 0)
        return true
      } else {
        return false
      }
    }
  }
}

export const okWithString = (expect: string, exact = false) => async (res: AppAndCount) => {
  // first try innerText
  return okWithCustom({ expect, exact })(res).catch(async err1 => {
    // use .textContent as a backup plan
    return okWithTextContent(expect, exact)(res).catch(() => {
      throw err1
    })
  })
}

export const okWithStringEventually = (expect: string, exact = false) => (res: AppAndCount) => {
  return res.app.client.waitUntil(() => {
    try {
      return okWithString(expect, exact)(res)
    } catch (err) {
      // swallow
    }
  }, waitTimeout)
}

/** as long as its ok, accept anything */
export const okWithAny = async (res: AppAndCount) => expectOK(res)

/** expect ok and *only* the given result value */
export const okWithOnly = (entityName: string) => async (res: AppAndCount) =>
  expectOK(res, { expectString: entityName })

/** expect ok and at least the given result value */
// FIXME: okWithAtLeast??
export const okWith = (entityName: string) => async (res: AppAndCount) => expectOK(res, { expectArray: [entityName] })

/** expect just ok, and no result value */
export const justOK = async (res: AppAndCount) => expectOK(res, { expectJustOK: true }).then(() => res.app)
