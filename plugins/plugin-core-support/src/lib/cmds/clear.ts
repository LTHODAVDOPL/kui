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

import { Capabilities, Commands, UI } from '@kui-shell/core'
import { resetCount } from '@kui-shell/core/webapp/cli'

const debug = Debug('plugins/core-support/clear')

const usage = {
  command: 'clear',
  strict: 'clear',
  example: 'clear',
  docs: 'Clear the console',
  optional: [{ name: '--keep-current-active', alias: '-k', boolean: true, hidden: true }]
}

const clear = ({ parsedOptions, tab }: Commands.Arguments) => {
  if (!Capabilities.isHeadless()) {
    if (!parsedOptions.k) {
      // don't keep the current active prompt
      debug('clearing everything, the repl loop will set up the next prompt for us')
      UI.empty(tab.querySelector('.repl-inner'))

      // abort the jobs for the current tab
      const tabState = tab.state
      tabState.abortAllJobs()
    } else {
      // keep the current active prompt
      debug('preserving the current active prompt')
      const selector = '.repl-inner .repl-block:not(.repl-active):not(.processing)'

      const blocks = tab.querySelectorAll(selector)
      for (let idx = 0; idx < blocks.length; idx++) {
        blocks[idx].parentNode.removeChild(blocks[idx])
      }

      const remainingBlock = tab.querySelector('.repl-block') as HTMLElement
      resetCount(remainingBlock)

      // return the current processing block, if there is one
      const processing = '.repl-inner .repl-block.processing'
      return (tab.querySelector(processing) as HTMLElement) || true
    }
  }

  // close the sidecar on clear
  UI.closeAllViews(tab)

  // tell the repl we're all good
  return true
}

/**
 * This plugin introduces the /clear command, which clear the consoles
 *
 */
export default (commandTree: Commands.Registrar) => {
  commandTree.listen('/clear', clear, {
    usage,
    noAuthOk: true,
    inBrowserOk: true
  })
}
