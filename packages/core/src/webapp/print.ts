/*
 * Copyright 2017-19 IBM Corporation
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
const debug = Debug('webapp/cli/print')
debug('loading')

import { Tab } from './tab'
import { setStatus, Status } from './status'
import { popupListen } from './listen'
import { SidecarMode as Mode } from './bottom-stripe'
import { isPopup } from './popup-core'
import { scrollIntoView } from './scroll'
import { renderPopupContent, createPopupContentContainer } from './popup'

import { formatTable } from './views/table'
import Presentation from './views/presentation'
import presentAs from './views/sidecar-present'
import { showEntity, showCustom, isCustomSpec } from './views/sidecar'

import { isHTML } from '../util/types'
import { promiseEach } from '../util/async'

import { isWatchable } from './models/basicModels'
import { Streamable, Stream } from '../models/streamable'
import { CommandHandlerWithEvents } from '../models/command'
import { Table, isTable, isMultiTable } from './models/table'
import { ExecOptions, ParsedOptions } from '../models/execOptions'
import { isMultiModalResponse } from '../models/mmr/is'
import { show as showMultiModalResponse } from '../models/mmr/show'
import { Entity, isEntitySpec, isMessageBearingEntity, MixedResponsePart, isMixedResponse } from '../models/entity'

import UsageError from '../core/usage-error'

/** plugins can register view handlers for a given type: string */
export type ViewHandler = (
  tab: Tab,
  response: Entity,
  resultDom: Element,
  parsedOptions: ParsedOptions,
  execOptions: ExecOptions
) => Promise<any> | void // eslint-disable-line @typescript-eslint/no-explicit-any
interface ViewRegistrar {
  [key: string]: ViewHandler
}

/**
 * Register a renderer for a given kind[]
 *
 */
const registeredListViews: ViewRegistrar = {}
export const registerListView = (kind: string, handler: ViewHandler) => {
  registeredListViews[kind] = handler
}

/**
 * Register a renderer for a given <kind>
 *
 */
const registeredEntityViews: ViewRegistrar = {}
export const registerEntityView = (kind: string, handler: ViewHandler) => {
  registeredEntityViews[kind] = handler
}

/**
 * Standard handling of Table responses
 *
 */
const printTable = async (
  tab: Tab,
  response: Table,
  resultDom: HTMLElement,
  execOptions?: ExecOptions,
  parsedOptions?: ParsedOptions
) => {
  //
  // some sort of list response; format as a table
  //
  const registeredListView = registeredListViews[response.type]
  if (registeredListView) {
    await registeredListView(tab, response, resultDom, parsedOptions, execOptions)
    return resultDom.children.length === 0
  }

  ;(resultDom.parentNode as HTMLElement).classList.add('result-as-table', 'result-as-vertical')

  if (response.noEntityColors) {
    // client wants control over entity-cell coloring
    resultDom.classList.add('result-table-with-custom-entity-colors')
  }

  formatTable(tab, response, resultDom)
}

/**
 * Stream output to the given block
 *
 */
export const streamTo = (tab: Tab, block: Element): Stream => {
  const container = block.querySelector('.repl-output') as HTMLElement
  const resultDom = container ? document.createElement('div') : (block.querySelector('.repl-result') as HTMLElement)
  if (container) {
    container.classList.add('repl-result-has-content')
    container.insertBefore(resultDom, container.childNodes[0])
  }

  let previousLine: HTMLElement
  return (response: Streamable, killLine = false): Promise<void> => {
    // debug('stream', response, killLine)
    resultDom.setAttribute('data-stream', 'data-stream')
    ;(resultDom.parentNode as HTMLElement).classList.add('result-vertical')

    if (killLine && previousLine) {
      previousLine.parentNode.removeChild(previousLine)
      previousLine = undefined
    }

    const formatPart = async (response: Streamable, resultDom: HTMLElement) => {
      if (UsageError.isUsageError(response)) {
        previousLine = await UsageError.getFormattedMessage(response)
        resultDom.appendChild(previousLine)
        resultDom.classList.add('oops')
        resultDom.setAttribute('data-status-code', response.code.toString())
      } else if (isMixedResponse(response)) {
        promiseEach(response, _ => {
          const para = document.createElement('p')
          para.classList.add('kui--mixed-response--text')
          resultDom.appendChild(para)
          return formatPart(_, para)
        })
      } else if (isHTML(response)) {
        response.classList.add('repl-result-like')
        previousLine = response
        resultDom.appendChild(previousLine)
      } else if (isMultiTable(response)) {
        response.tables.forEach(async _ => printTable(tab, _, resultDom))
        const br = document.createElement('br')
        resultDom.appendChild(br)
      } else if (isTable(response)) {
        const wrapper = document.createElement('div')
        wrapper.classList.add('repl-result')
        resultDom.appendChild(wrapper)
        await printTable(tab, response, wrapper)
      } else if (isCustomSpec(response)) {
        showCustom(tab, response, {})
      } else {
        previousLine = document.createElement('pre')
        previousLine.classList.add('streaming-output', 'repl-result-like')
        previousLine.innerText = isMessageBearingEntity(response) ? response.message : response.toString()
        resultDom.appendChild(previousLine)
      }
    }

    return formatPart(response, resultDom).then(() => {
      scrollIntoView({ element: resultDom, when: 0 })
    })
  }
}

/**
 *
 *
 */
export const ok = (parentNode: Element, suffix?: string | Element, css?: string) => {
  const okLine = document.createElement('div')
  okLine.classList.add('ok-line')

  const replResultBlock = parentNode.parentNode.querySelector('.repl-result')
  const resultHasContent = replResultBlock.children.length > 0
  if (resultHasContent) {
    ;(replResultBlock.parentNode as Element).classList.add('repl-result-has-content')
  }

  const ok = document.createElement('span')
  okLine.appendChild(ok)
  ok.classList.add('ok')
  ok.appendChild(document.createTextNode(suffix ? 'ok:' : 'ok'))

  if (suffix) {
    ok.classList.add('inline-ok')
    okLine.appendChild(typeof suffix === 'string' ? document.createTextNode(` ${suffix}`) : suffix)
  }

  if (css) {
    okLine.classList.add(css)
  }

  parentNode.appendChild(okLine)
  return okLine
}

export async function renderResult(
  response: Entity,
  tab: Tab,
  execOptions: ExecOptions,
  parsedOptions: ParsedOptions,
  resultDom: HTMLElement,
  echo = true,
  attach = echo
) {
  if (isTable(response)) {
    await printTable(tab, response, resultDom, execOptions, parsedOptions)
    return true
  } else if (isHTML(response)) {
    // TODO is this the best way to detect response is a dom??
    // pre-formatted DOM element
    if (attach) {
      resultDom.appendChild(response)
    }
    if (echo) {
      ;(resultDom.parentNode as HTMLElement).classList.add('result-vertical')
      ok(resultDom.parentElement).classList.add('ok-for-list')
    }
    return true
  } else {
    return false
  }
}

export function replResult() {
  const resultContainer = document.createElement('div')
  const resultDom = document.createElement('div')
  resultDom.classList.add('repl-result')
  resultContainer.appendChild(resultDom)
  return resultDom
}

/**
 * Render the results of a command evaluation in the "console"
 *
 */
export const printResults = (
  block: HTMLElement,
  nextBlock: HTMLElement,
  tab: Tab,
  resultDom: HTMLElement,
  echo = true,
  execOptions?: ExecOptions,
  parsedOptions?: ParsedOptions,
  command?: string,
  evaluator?: CommandHandlerWithEvents
) => (response: Entity) => {
  debug('printResults', response)

  // does the command handler want to be incognito in the UI?
  const incognitoHint = evaluator && evaluator.options && evaluator.options.incognito && evaluator.options.incognito
  const incognito = incognitoHint && isPopup() && incognitoHint.indexOf('popup') >= 0

  const presentation = isCustomSpec(response) && response.presentation

  let customContainer: HTMLElement
  if (isPopup() && !incognito) {
    resultDom = customContainer = createPopupContentContainer(
      ['valid-response'],
      presentation || (!Array.isArray(response) && Presentation.SidecarFullscreenForPopups)
    )
  }

  if (process.env.KUI_TEE_TO_FILE) {
    // we were asked to tee the output to the system console
    debug('teeing output to file', process.env.KUI_TEE_TO_FILE)
    import('../util/tee').then(_ => _.default(response))
  }

  if (echo) {
    setStatus(block, response === false ? Status.error : Status.validResponse)
  }

  const render = async (response: Entity, { echo, resultDom }: { echo: boolean; resultDom: HTMLElement }) => {
    if (response && response !== true) {
      if (await renderResult(response, tab, execOptions, parsedOptions, resultDom, echo)) {
        // then renderResult took care of things
      } else if (typeof response === 'number' || typeof response === 'string' || isMessageBearingEntity(response)) {
        // if either the response is a string, or it's a non-entity (no response.type) and has a message field
        //     then treat the response as a simple string response
        if (echo) {
          // wrap in a span so that drag text selection works; see shell issue #249
          const span = document.createElement('pre')
          span.innerText = isMessageBearingEntity(response) ? response.message : response.toString()
          resultDom.appendChild(span)
          ;(resultDom.parentNode as HTMLElement).classList.add('result-vertical')
          ok(resultDom.parentElement).classList.add('ok-for-list')
        }
      } else if (isCustomSpec(response)) {
        if (echo || (execOptions && execOptions.replSilence)) {
          await showCustom(
            tab,
            response,
            isPopup() ? Object.assign({}, execOptions, { leaveBottomStripeAlone: true }) : execOptions,
            customContainer
          )

          if (!isPopup()) {
            ok(resultDom.parentElement)
          }

          /* if (typeof presentation !== undefined) {
            response.presentation = presentation
          } */

          return !customContainer || customContainer.children.length === 0
        }
      } else if (isEntitySpec(response) && registeredEntityViews[response.type]) {
        // there is a registered entity view handler for this response
        if (await registeredEntityViews[response.type](tab, response, resultDom, parsedOptions, execOptions)) {
          if (echo) ok(resultDom.parentElement)
        }

        // we rendered the content?
        return resultDom.children.length === 0
      } else if (isEntitySpec(response) && response.verb === 'delete') {
        if (echo) {
          // we want the 'ok:' part to appear even in popup mode
          if (response.type) {
            ok(resultDom, `deleted ${response.type.replace(/s$/, '')} ${response.name}`, 'show-in-popup')
          } else {
            ok(resultDom)
          }
        }
      } else if (
        isEntitySpec(response) &&
        (response.verb === 'get' || response.verb === 'create' || response.verb === 'update')
      ) {
        // get response?
        const forRepl = await showEntity(
          tab,
          response,
          Object.assign({}, execOptions || {}, {
            echo,
            show: response.show || 'default'
          })
        )

        // forRepl means: the sidecar wants to display something on the repl when it's done
        // it's either a promise or a DOM entry directly
        if (echo) {
          if (forRepl && forRepl !== true) {
            render(forRepl, { echo, resultDom })
          } else if (forRepl) {
            ok(resultDom.parentElement)
          }
        }

        // we rendered the content
        return true
      } else if (isMultiModalResponse(response)) {
        await showMultiModalResponse(tab, response)
        if (!isPopup()) {
          ok(resultDom.parentElement)
        }
      } else if (isMixedResponse(response)) {
        debug('mixed response')
        const paragraph = (part: MixedResponsePart) => {
          if (typeof part === 'string') {
            const para = document.createElement('p')
            para.classList.add('kui--mixed-response--text')
            para.innerText = part
            return para
          } else {
            return part
          }
        }

        response.forEach(part => {
          printResults(block, nextBlock, tab, resultDom, echo, execOptions, parsedOptions, command, evaluator)(
            paragraph(part)
          )
        })
      } else if (typeof response === 'object') {
        // render random json in the REPL directly
        const code = document.createElement('code')
        code.appendChild(document.createTextNode(JSON.stringify(response, undefined, 4)))
        resultDom.appendChild(code)
        code.classList.add('hljs', 'json') // we have some CSS rules that trigger off these
        ;(resultDom.parentNode as HTMLElement).classList.add('result-vertical')
        ok(resultDom.parentElement).classList.add('ok-for-list')
      }
    } else if (response) {
      if (echo) ok(resultDom.parentElement)
    }
  }

  let promise: Promise<boolean>

  // print ok if it's an empty table
  if (!isWatchable(response) && isTable(response) && response.body.length === 0) {
    response = true
  }

  if (isMultiTable(response)) {
    ;(resultDom.parentNode as HTMLElement).classList.add('result-as-table', 'result-as-multi-table', 'result-vertical')

    const tables = response.tables

    if (tables[0].flexWrap) {
      ;(resultDom.parentNode as HTMLElement).classList.add('result-as-multi-table-flex-wrap')
    }

    // multi-table output; false means that the renderer hasn't placed
    // anything in the DOM; it's up to us here
    promise = Promise.resolve(formatTable(tab, response, resultDom)).then(() => false)
  } else {
    promise = render(response, { echo, resultDom })
  }

  if (isTable(response) || isMultiTable(response)) {
    if (isPopup()) {
      presentAs(tab, Presentation.FixedSize)
    }
    // say "ok"
    if (echo) {
      promise.then(() => {
        ok(resultDom.parentNode as Element).classList.add('ok-for-list')
      })
    }
  }

  return promise.then(async (alreadyRendered: boolean) => {
    if (
      isPopup() &&
      (Array.isArray(response) ||
        (customContainer && customContainer.children.length > 0) ||
        (isCustomSpec(response) && response.presentation === Presentation.FixedSize))
    ) {
      if (!incognito) {
        // view modes
        const modes: Mode[] = isEntitySpec(response) && response.modes

        // entity type
        // Notes: if we have a table, pull from the first row
        // (see https://github.com/IBM/kui/issues/3052)
        const prettyType =
          (isTable(response) && response.title) ||
          (isTable(response) &&
            response.body[0] &&
            (response.body[0].prettyType ||
              response.body[0].prettyKind ||
              response.body[0].type ||
              response.body[0].kind)) ||
          (isEntitySpec(response) &&
            (response.kind || response.prettyType || response.prettyKind || response.type || response.kind)) ||
          false

        // presentation mode
        const presentation =
          (isCustomSpec(response) && response.presentation) ||
          (prettyType && Array.isArray(response) && Presentation.FixedSize) ||
          Presentation.SidecarFullscreenForPopups

        // Notes: we try to avoid "custom" in the display, since
        // "custom" is an internal term of the low-level kui
        // CustomSpec API. If we weren't able to find a reasonable
        // prettyType in the above logic, then use the command that
        // the user executed
        await renderPopupContent(
          command,
          alreadyRendered !== true && resultDom,
          execOptions,
          Object.assign({}, response, {
            modes: modes || undefined,
            prettyType,
            badges: isCustomSpec(response) && response.badges,
            controlHeaders: isEntitySpec(response) && response.controlHeaders,
            presentation
          })
        )
      }

      if (!incognito) {
        // add the command to the popup CLI, unless the command does
        // not wish itself to be known in the popup CLI
        popupListen(undefined, command)
      }
    }
  })
}
