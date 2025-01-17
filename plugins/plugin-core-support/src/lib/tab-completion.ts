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
import { lstat, readdir, realpath } from 'fs'
import { basename, dirname as pathDirname, join } from 'path'

import { applyEnumerator } from './tab-completion-registrar'

import Capabilities from '@kui-shell/core/api/capabilities'
import Errors from '@kui-shell/core/api/errors'
import * as REPLUtil from '@kui-shell/core/api/repl-util'
import Tables from '@kui-shell/core/api/tables'
import * as UI from '@kui-shell/core/api/ui-lite'
import * as LowLevel from '@kui-shell/core/api/ui-low-level'
import { injectCSS } from '@kui-shell/core/api/inject'
import Util from '@kui-shell/core/api/util'

const debug = Debug('plugins/core-support/tab completion')

/**
 * Install keyboard up-arrow and down-arrow handlers in the given REPL
 * prompt. This needs to be installed in the prompt, as ui.js installs
 * the equivalent handlers in the prompt as well.
 *
 */
const listenForUpDown = (prompt: HTMLInputElement) => {
  const moveTo = (nextOp: string, evt: Event) => {
    const block = UI.getCurrentBlock()
    const temporaryContainer = block && block.querySelector('.tab-completion-temporary')

    if (temporaryContainer) {
      const current = temporaryContainer.querySelector('.selected')
      if (current) {
        const next = current[nextOp]

        if (next) {
          current.classList.remove('selected')
          next.classList.add('selected')
          next.scrollIntoView()
          evt.preventDefault() // prevent REPL processing
        }
      }
    }
  }

  const previousKeyDown = prompt.onkeydown
  prompt.onkeydown = evt => {
    // keydown is necessary for evt.preventDefault() to work; keyup would otherwise also work
    const char = evt.keyCode

    if (char === UI.Keys.Codes.DOWN) {
      moveTo('nextSibling', evt)
    } else if (char === UI.Keys.Codes.UP) {
      moveTo('previousSibling', evt)
    } else if (char === UI.Keys.Codes.C && evt.ctrlKey) {
      // Ctrl+C, cancel
      LowLevel.doCancel()
    }
  }

  // cleanup routine
  return () => {
    prompt.onkeydown = previousKeyDown
  }
}

/**
 * Listen for escape key, and remove tab completion popup, if it is
 * visible
 *
 */
const listenForEscape = () => {
  // listen for escape key
  const previousKeyup = document.onkeyup
  const cleanup = () => {
    document.onkeyup = previousKeyup
  }

  document.onkeyup = evt => {
    if (evt.keyCode === UI.Keys.Codes.ESCAPE) {
      const block = UI.getCurrentBlock()
      const temporaryContainer = block && (block.querySelector('.tab-completion-temporary') as TemporaryContainer)

      if (temporaryContainer) {
        evt.preventDefault()
        temporaryContainer.cleanup()
      }
    }
  }

  return cleanup
}

/**
 * Install keyboard event handlers into the given REPL prompt.
 *
 */
const installKeyHandlers = (prompt: HTMLInputElement) => {
  if (prompt) {
    return [listenForUpDown(prompt), listenForEscape()]
  } else {
    return []
  }
}

/**
 * Make a container UI for tab completions
 *
 */
const makeCompletionContainer = (
  block: HTMLElement,
  prompt: HTMLInputElement,
  partial: string,
  dirname?: string,
  lastIdx?: number
) => {
  const temporaryContainer = document.createElement('div') as TemporaryContainer
  temporaryContainer.className = 'tab-completion-temporary repl-temporary'

  const scrollContainer = document.createElement('div')
  scrollContainer.className = 'tab-completion-scroll-container'
  temporaryContainer.appendChild(scrollContainer)
  temporaryContainer.scrollContainer = scrollContainer

  if (!process.env.RUNNING_SHELL_TEST) {
    // see shell issue #699; chrome seems not to play the fade-in
    // animation when the window is offscreen
    temporaryContainer.classList.add('fade-in')
  }

  // for later completion
  temporaryContainer.partial = partial
  temporaryContainer.dirname = dirname
  temporaryContainer.lastIdx = lastIdx
  temporaryContainer.currentMatches = []

  block.appendChild(temporaryContainer)
  const handlers = installKeyHandlers(prompt)

  /** respond to change of prompt value */
  const onChange = () => {
    if (!prompt.value.endsWith(partial)) {
      // oof! then the prompt changed substantially; get out of
      // here quickly
      return temporaryContainer.cleanup()
    }

    const args = REPLUtil.split(prompt.value)
    const currentText = args[temporaryContainer.lastIdx]
    const prevMatches = temporaryContainer.currentMatches
    const newMatches = prevMatches.filter(({ match }) => match.indexOf(currentText) === 0)
    const removedMatches = prevMatches.filter(({ match }) => match.indexOf(currentText) !== 0)

    temporaryContainer.currentMatches = newMatches
    removedMatches.forEach(({ option }) => temporaryContainer.removeChild(option))

    temporaryContainer['partial'] = currentText

    if (temporaryContainer.currentMatches.length === 0) {
      // no more matches, so remove the temporary container
      temporaryContainer.cleanup()
    }
  }
  prompt.addEventListener('input', onChange)

  temporaryContainer.cleanup = () => {
    try {
      block.removeChild(temporaryContainer)
    } catch (err) {
      // already removed
    }
    try {
      handlers.forEach(cleanup => cleanup())
    } catch (err) {
      // just in case
    }
    prompt.removeEventListener('input', onChange)
  }

  // in case the container scrolls off the bottom TODO we should
  // probably have it positioned above, so as not to introduce
  // scrolling?
  setTimeout(() => block.scrollIntoView(), 0)

  return temporaryContainer
}

/**
 * Escape the given string for bash happiness
 *
 */
const shellescape = (str: string): string => {
  return str.replace(/ /g, '\\ ')
}

/**
 * Return partial updated with the given match; there may be some
 * overlap at the beginning.
 *
 */
const completeWith = (partial: string, match: string, doEscape = false, addSpace = false): string => {
  const escapedMatch = !doEscape ? match : shellescape(match) // partial is escaped already, so escape the match, too
  const partialIdx = escapedMatch.indexOf(partial)
  const remainder = partialIdx >= 0 ? escapedMatch.substring(partialIdx + partial.length) : escapedMatch
  return remainder + (addSpace ? ' ' : '')
}

/**
 * Is the given filepath a directory?
 *
 */
const isDirectory = (filepath: string): Promise<boolean> =>
  new Promise((resolve, reject) => {
    lstat(filepath, (err, stats) => {
      if (err) {
        reject(err)
      } else {
        if (stats.isSymbolicLink()) {
          debug('following symlink')
          // TODO: consider turning these into the better async calls?
          return realpath(filepath, (err, realpath) => {
            if (err) {
              reject(err)
            } else {
              return isDirectory(realpath)
                .then(resolve)
                .catch(reject)
            }
          })
        }

        resolve(stats.isDirectory())
      }
    })
  })

/**
 * We've found a match. Add this match to the given partial match,
 * located in the given dirname'd directory, and update the given
 * prompt, which is an <input>.
 *
 */
const complete = (
  match: string,
  prompt: HTMLInputElement,
  options: {
    temporaryContainer?: TemporaryContainer
    partial?: string
    dirname?: false | string
    doEscape?: boolean
    addSpace?: boolean
  }
) => {
  const temporaryContainer = options.temporaryContainer
  const partial = options.partial || (temporaryContainer && temporaryContainer.partial)
  const dirname = options.dirname || (temporaryContainer && temporaryContainer.dirname)
  const doEscape = options.doEscape || false
  const addSpace = options.addSpace || false

  debug('completion', match, partial, dirname)

  // in case match includes partial as a prefix
  const completion = completeWith(partial, match, doEscape, addSpace)

  if (temporaryContainer) {
    temporaryContainer.cleanup()
  }

  const addToPrompt = (extra: string): void => {
    prompt.value = prompt.value + extra

    // make sure the new text is visible
    // see https://github.com/IBM/kui/issues/1367
    prompt.scrollLeft = prompt.scrollWidth
  }

  if (dirname) {
    // see if we need to add a trailing slash
    const filepath = Util.expandHomeDir(join(dirname, match))
    isDirectory(filepath)
      .then(isDir => {
        if (isDir) {
          // add a trailing slash if the dirname/match is a directory
          debug('complete as directory')
          addToPrompt(completion + '/')
        } else {
          // otherwise, dirname/match is not a directory
          debug('complete as scalar')
          addToPrompt(completion)
        }
      })
      .catch(err => {
        console.error(err)
      })
  } else {
    // otherwise, just add the completion to the prompt
    debug('complete as scalar (alt)')
    addToPrompt(completion)
  }
}

/**
 * Add a suggestion to the suggestion container
 *
 */
const addSuggestion = (
  temporaryContainer: TemporaryContainer,
  prefix: string,
  dirname: string,
  prompt: HTMLInputElement,
  doEscape = false
) => (match, idx: number) => {
  const matchLabel = match.label || match
  const matchCompletion = match.completion || matchLabel

  const option = document.createElement('div')
  const optionInnerFill = document.createElement('span')
  const optionInner = document.createElement('a')

  const innerPre = document.createElement('span')
  const innerPost = document.createElement('span')
  optionInner.appendChild(innerPre)
  optionInner.appendChild(innerPost)

  temporaryContainer.scrollContainer.appendChild(option)
  option.appendChild(optionInnerFill)
  optionInnerFill.appendChild(optionInner)

  // we want the clickable part to fill horizontal space
  optionInnerFill.className = 'tab-completion-temporary-fill'

  innerPre.innerText = prefix
  innerPost.innerText = matchLabel.replace(new RegExp(`^${prefix}`), '')

  // maybe we have a doc string for the match?
  if (match.docs) {
    const optionDocs = document.createElement('span')
    optionDocs.className = 'deemphasize deemphasize-partial left-pad'
    option.appendChild(optionDocs)
    optionDocs.innerText = `(${match.docs})`
  }

  option.className = 'tab-completion-option'
  optionInner.className = 'clickable plain-anchor'
  innerPre.classList.add('tab-completion-option-pre')
  innerPost.classList.add('tab-completion-option-post')

  if (idx === 0) {
    // first item is selected by default
    option.classList.add('selected')
  }

  // onclick, use this match as the completion
  option.addEventListener('click', () => {
    complete(matchCompletion, prompt, {
      temporaryContainer,
      dirname,
      doEscape,
      addSpace: match.addSpace
    })
  })

  option.setAttribute('data-match', matchLabel)
  option.setAttribute('data-completion', matchCompletion)
  if (match.addSpace) option.setAttribute('data-add-space', match.addSpace)
  if (doEscape) option.setAttribute('data-do-escape', 'true')
  option.setAttribute('data-value', optionInner.innerText)

  // for incremental completion; see onChange handler above
  temporaryContainer.currentMatches.push({
    match: matchLabel,
    completion: matchCompletion,
    option
  })

  return { option, optionInner, innerPost }
}

/**
 * Given a list of matches to the partial that is in the
 * prompt.value, update prompt.value so that it contains the longest
 * common prefix of the matches
 *
 */
const updateReplToReflectLongestPrefix = (
  prompt: HTMLInputElement,
  matches: string[],
  temporaryContainer: TemporaryContainer,
  partial = temporaryContainer.partial
) => {
  if (matches.length > 0) {
    const shortest = matches.reduce(
      (minLength: false | number, match) => (!minLength ? match.length : Math.min(minLength, match.length)),
      false
    )
    let idx = 0

    const partialComplete = (idx: number) => {
      // debug('partial complete', idx)
      const completion = completeWith(partial, matches[0].substring(0, idx), true)
      if (completion.length > 0) {
        temporaryContainer.partial = completion
        prompt.value = prompt.value + completion
      }
      return temporaryContainer.partial
    }

    for (idx = 0; idx < shortest; idx++) {
      const char = matches[0].charAt(idx)

      for (let jdx = 1; jdx < matches.length; jdx++) {
        const other = matches[jdx].charAt(idx)
        if (char !== other) {
          if (idx > 0) {
            // then we found some common prefix
            // debug('partial complete midway')
            return partialComplete(idx)
          } else {
            // debug('no partial completion :(')
            return
          }
        }
      }
    }

    if (idx > 0) {
      // debug('partial complete at end')
      return partialComplete(idx)
    }
  }
}

/**
 * Given a list of entities, filter them and present options
 *
 */
const presentEnumeratorSuggestions = (
  block: HTMLElement,
  prompt: HTMLInputElement,
  temporaryContainer: TemporaryContainer,
  lastIdx: number,
  last: string
) => (filteredList: string[]): void => {
  debug('presentEnumeratorSuggestions', filteredList)
  if (filteredList.length === 1) {
    complete(filteredList[0], prompt, { partial: last, dirname: false })
  } else if (filteredList.length > 0) {
    const partial = last
    const dirname = undefined
    if (!temporaryContainer) {
      temporaryContainer = makeCompletionContainer(block, prompt, partial, dirname, lastIdx)
    }

    updateReplToReflectLongestPrefix(prompt, filteredList, temporaryContainer)
    filteredList.forEach(addSuggestion(temporaryContainer, last, dirname, prompt))
  }
}

interface Match {
  match: string
  completion: any // eslint-disable-line @typescript-eslint/no-explicit-any
  option: HTMLElement
}

/** declaration-merge on HTMLDivElement */
interface TemporaryContainer extends HTMLDivElement {
  scrollContainer: HTMLElement
  lastIdx?: number
  partial?: string
  dirname?: string
  cleanup?: () => void
  currentMatches?: Match[]
}

/**
 * Suggest completions for a local file
 *
 */
const suggestLocalFile = (
  last: string,
  block: HTMLElement,
  prompt: HTMLInputElement,
  temporaryContainer: TemporaryContainer,
  lastIdx: number
) => {
  // dirname will "foo" in the above example; it
  // could also be that last is itself the name
  // of a directory
  const lastIsDir = last.charAt(last.length - 1) === '/'
  const dirname = lastIsDir ? last : pathDirname(last)

  debug('suggest local file', dirname, last)

  if (dirname) {
    // then dirname exists! now scan the directory so we can find matches
    readdir(Util.expandHomeDir(dirname), (err, files) => {
      if (err) {
        debug('fs.readdir error', err)
      } else {
        const partial = basename(last) + (lastIsDir ? '/' : '')
        const matches: string[] = files.filter(_f => {
          const f = shellescape(_f)
          return (lastIsDir || f.indexOf(partial) === 0) && !f.endsWith('~') && f !== '.' && f !== '..'
        })

        debug('fs.readdir success', partial, matches)

        if (matches.length === 1) {
          //
          // then there is one unique match, so autofill it now;
          // completion will be the bit we have to append to the current prompt.value
          //
          debug('singleton file completion', matches[0])
          complete(matches[0], prompt, {
            temporaryContainer,
            doEscape: true,
            partial,
            dirname
          })
        } else if (matches.length > 1) {
          //
          // then there are multiple matches, present the choices
          //
          debug('multi file completion')

          // make a temporary div to house the completion options,
          // and attach it to the block that encloses the current prompt
          if (!temporaryContainer) {
            temporaryContainer = makeCompletionContainer(block, prompt, partial, dirname, lastIdx)
          }

          updateReplToReflectLongestPrefix(prompt, matches, temporaryContainer)

          // add each match to that temporary div
          matches.forEach((match, idx) => {
            const { option, optionInner, innerPost } = addSuggestion(temporaryContainer, '', dirname, prompt, true)(
              match,
              idx
            )

            // see if the match is a directory, so that we add a trailing slash
            const filepath = join(dirname, match)
            isDirectory(filepath)
              .then(isDir => {
                if (isDir) {
                  innerPost.innerText = innerPost.innerText + '/'
                }
                option.setAttribute('data-value', optionInner.innerText)
              })
              .catch(err => {
                console.error(err)
              })
          })
        }
      }
    })
  }
}

/**
 * Given a list of entities, filter them and present options
 *
 */
const filterAndPresentEntitySuggestions = (
  last: string,
  block: HTMLElement,
  prompt: HTMLInputElement,
  temporaryContainer: TemporaryContainer,
  lastIdx: number
) => entities => {
  debug('filtering these entities', entities)
  debug('against this filter', last)

  // find matches, given the current prompt contents
  const filteredList = entities
    .map(({ name, packageName, namespace }) => {
      const packageNamePart = packageName ? `${packageName}/` : ''
      const actionWithPackage = `${packageNamePart}${name}`
      const fqn = `/${namespace}/${actionWithPackage}`

      return (
        (name.indexOf(last) === 0 && actionWithPackage) ||
        (actionWithPackage.indexOf(last) === 0 && actionWithPackage) ||
        (fqn.indexOf(last) === 0 && fqn)
      )
    })
    .filter(x => x)

  debug('filtered list', filteredList)

  if (filteredList.length === 1) {
    // then we found just one match; we can complete it now,
    // without bothering with a completion popup
    debug('singleton entity match', filteredList[0])
    complete(filteredList[0], prompt, { partial: last, dirname: false })
  } else if (filteredList.length > 0) {
    // then we found multiple matches; we need to render them as
    // a tab completion popup
    const partial = last
    const dirname = undefined

    if (!temporaryContainer) {
      temporaryContainer = makeCompletionContainer(block, prompt, partial, dirname, lastIdx)
    }

    updateReplToReflectLongestPrefix(prompt, filteredList, temporaryContainer)

    filteredList.forEach(addSuggestion(temporaryContainer, last, dirname, prompt))
  }
}

/**
 * Command not found, but we have command completions to offer the user
 *
 */
const suggestCommandCompletions = (
  _matches,
  partial: string,
  block: HTMLElement,
  prompt: HTMLInputElement,
  temporaryContainer: TemporaryContainer
) => {
  // don't suggest anything without a usage model, and then align to
  // the addSuggestion model
  const matches = _matches
    .filter(({ usage, docs }) => usage || docs)
    .map(
      ({
        command,
        docs,
        usage = {
          command,
          docs,
          commandPrefix: undefined,
          title: undefined,
          header: undefined
        }
      }) => ({
        label: command,
        completion: command,
        addSpace: true,
        docs: usage.title || usage.header || usage.docs // favoring shortest first
      })
    )

  if (matches.length === 1) {
    debug('singleton command completion', matches[0])
    complete(matches[0].completion, prompt, { partial, dirname: false })
  } else if (matches.length > 0) {
    debug('suggesting command completions', matches, partial)

    if (!temporaryContainer) {
      temporaryContainer = makeCompletionContainer(block, prompt, partial)
    }

    // add suggestions to the container
    matches.forEach(addSuggestion(temporaryContainer, partial, undefined, prompt))
  }
}

/**
 * Suggest options
 *
 */
const suggest = (
  param,
  last: string,
  block: HTMLElement,
  prompt: HTMLInputElement,
  temporaryContainer: TemporaryContainer,
  lastIdx: number
) => {
  if (param.file) {
    // then the expected parameter is a file; we can auto-complete
    // based on the contents of the local filesystem
    return suggestLocalFile(last, block, prompt, temporaryContainer, lastIdx)
  } else if (param.entity) {
    // then the expected parameter is an existing entity; so we
    // can enumerate the entities of the specified type
    const tab = UI.getTabFromTarget(block)
    return tab.REPL.qexec<Tables.Table>(`${param.entity} list --limit 200`)
      .then(response => response.body)
      .then(filterAndPresentEntitySuggestions(basename(last), block, prompt, temporaryContainer, lastIdx))
  }
}

/**
 * This plugin implements tab completion in the REPL.
 *
 */
export default () => {
  if (typeof document === 'undefined') return

  if (Capabilities.inBrowser()) {
    injectCSS({
      css: require('@kui-shell/plugin-core-support/web/css/tab-completion.css'),
      key: 'tab-completion.css'
    })
  } else {
    const root = pathDirname(require.resolve('@kui-shell/plugin-core-support/package.json'))
    injectCSS(join(root, 'web/css/tab-completion.css'))
  }

  // keydown is necessary for evt.preventDefault() to work; keyup would otherwise also work
  let currentEnumeratorAsync: number
  document.addEventListener('keydown', async (evt: KeyboardEvent) => {
    const block = UI.getCurrentBlock()
    const temporaryContainer = block && (block.querySelector('.tab-completion-temporary') as TemporaryContainer)

    if (evt.keyCode === UI.Keys.Codes.ENTER) {
      if (temporaryContainer) {
        //
        // user hit enter, and we have a temporary container open; remove it
        //

        // first see if we have a selection; if so, add it to the input
        const current = temporaryContainer.querySelector('.selected')
        if (current) {
          const completion = current.getAttribute('data-completion')
          const doEscape = current.hasAttribute('data-do-escape')
          const addSpace = current.hasAttribute('data-add-space')
          const prompt = UI.getCurrentPrompt()

          complete(completion, prompt, {
            temporaryContainer,
            doEscape,
            addSpace
          })
        }

        // prevent the REPL from evaluating the expr
        evt.preventDefault()

        // now remove the container from the DOM
        try {
          temporaryContainer.cleanup()
        } catch (err) {
          // it may have already been removed elsewhere
        }
      }
    } else if (evt.keyCode === UI.Keys.Codes.TAB) {
      const prompt = UI.getCurrentPrompt()

      if (prompt) {
        if (LowLevel.isUsingCustomPrompt(prompt)) {
          // there is a custom prompt, we want to swallow the tab, to
          // maintain focus on the prompt
          evt.preventDefault()
          return true
        }

        const value = prompt.value
        if (value) {
          evt.preventDefault() // for now at least, we want to keep the focus on the current <input>

          if (temporaryContainer) {
            // we already have a temporaryContainer
            // attached to the block, so tab means cycle
            // through the options
            const current = temporaryContainer.querySelector('.selected')
            const next = (current.nextSibling ||
              temporaryContainer.querySelector('.tab-completion-option:first-child')) as HTMLElement
            if (next) {
              current.classList.remove('selected')
              next.classList.add('selected')
              next.scrollIntoView()
            }
            return
          }

          const handleUsage = (usageError /* Errors.UsageError */) => {
            const usage = usageError.raw ? usageError.raw.usage || usageError.raw : usageError.usage || usageError
            debug('usage', usage, usageError)

            if (usage.fn) {
              // resolve the generator and retry
              debug('resolving generator')
              handleUsage(usage.fn(usage.command))
            } else if (usageError.partialMatches || usageError.available) {
              // command not found, with partial matches that we can offer the user

              suggestCommandCompletions(
                usageError.partialMatches || usageError.available,
                prompt.value,
                block,
                prompt,
                temporaryContainer
              )
            } else if (usage && usage.command) {
              // so we have a usage model; let's
              // determine what parameters we might be
              // able to help with
              const required = usage.required || []
              const optionalPositionals = (usage.optional || []).filter(({ positional }) => positional)

              const oneofs = usage.oneof ? [usage.oneof[0]] : []
              const positionals = required.concat(oneofs).concat(optionalPositionals)

              debug('positionals', positionals)
              if (positionals.length > 0) {
                const args = REPLUtil.split(prompt.value).filter(_ => !/^-/.test(_)) // this is the "argv", for the current prompt value
                const commandIdx = args.indexOf(usage.command) // the terminal command of the prompt
                const nActuals = args.length - commandIdx - 1
                const lastIdx = Math.max(0, nActuals - 1) // if no actuals, use first param
                const param = positionals[lastIdx]

                debug('maybe', args, commandIdx, lastIdx, nActuals, param, args[commandIdx + lastIdx])

                if (commandIdx === args.length - 1 && !prompt.value.match(/\s+$/)) {
                  // then the prompt has e.g. "wsk package" with no terminal whitespace; nothing to do yet
                } else if (param) {
                  // great, there is a positional we can help with
                  try {
                    // we found a required positional parameter, now suggest values for this parameter
                    suggest(
                      param,
                      Util.findFile(args[commandIdx + lastIdx + 1], { safe: true }),
                      block,
                      prompt,
                      temporaryContainer,
                      commandIdx + lastIdx
                    )
                  } catch (err) {
                    console.error(err)
                  }
                }
              }
            } else if (!Capabilities.inBrowser()) {
              const { A: args, endIndices } = REPLUtil._split(prompt.value, true, true) as REPLUtil.Split
              const lastIdx = prompt.selectionStart
              debug('falling back on local file completion', args, lastIdx)

              for (let ii = 0; ii < endIndices.length; ii++) {
                if (endIndices[ii] >= lastIdx) {
                  // trim beginning only; e.g. `ls /tmp/mo\ ` <-- we need that trailing space
                  const last = prompt.value.substring(endIndices[ii - 1], lastIdx).replace(/^\s+/, '')
                  suggestLocalFile(last, block, prompt, temporaryContainer, lastIdx)
                  break
                }
              }
            }
          }

          const lastIdx = prompt.selectionStart
          const { A: argv, endIndices } = REPLUtil._split(prompt.value, true, true) as REPLUtil.Split

          const minimist = await import('yargs-parser')
          const options = minimist(argv)

          const toBeCompletedIdx = endIndices.findIndex(idx => idx >= lastIdx) // e.g. git branch f<tab>
          const completingTrailingEmpty = lastIdx > endIndices[endIndices.length - 1] // e.g. git branch <tab>
          if (toBeCompletedIdx >= 0 || completingTrailingEmpty) {
            // trim beginning only; e.g. `ls /tmp/mo\ ` <-- we need that trailing space
            const last = completingTrailingEmpty
              ? ''
              : prompt.value.substring(endIndices[toBeCompletedIdx - 1], lastIdx).replace(/^\s+/, '')

            // argvNoOptions is argv without the options; we can get
            // this directly from yargs-parser's '_'
            const argvNoOptions = options._
            delete options._ // so that parsedOptions doesn't have the '_' part

            // a parsed out version of the command line
            const commandLine = {
              command: prompt.value,
              argv,
              argvNoOptions,
              parsedOptions: options
            }

            // a specification of what we want to be completed
            const spec = {
              toBeCompletedIdx, // index into argv
              toBeCompleted: last // how much of that argv has been filled in so far
            }

            const gotSomeCompletions = await new Promise<boolean>(resolve => {
              if (currentEnumeratorAsync) {
                // overruled case 1: after we started the async, we
                // notice that there is an outstanding tab completion
                // request; here we try cancelling it, in the hopes
                // that it hasn't already started its remote fetch;
                // this is request2 overruling request1
                clearTimeout(currentEnumeratorAsync)
              }

              const myEnumeratorAsync = setTimeout(async () => {
                const completions = await applyEnumerator(commandLine, spec)

                if (myEnumeratorAsync !== currentEnumeratorAsync) {
                  // overruled case 2: while waiting to fetch the
                  // completions, a second tab completion request was
                  // initiated; this is request1 overruling itself,
                  // after noticing that a (later) request2 is also in
                  // flight --- the rest of this method is
                  // synchronous, so this should be the last necessary
                  // race check
                  return
                }

                if (completions && completions.length > 0) {
                  presentEnumeratorSuggestions(block, prompt, temporaryContainer, lastIdx, last)(completions)
                  currentEnumeratorAsync = undefined
                  resolve(true)
                } else {
                  resolve(false)
                }
              })
              currentEnumeratorAsync = myEnumeratorAsync
            })

            if (gotSomeCompletions) {
              return
            }

            // intentional fall-through
          }

          try {
            debug('fetching usage', value)
            const tab = UI.getTabFromTarget(block)
            const usage: Promise<Errors.UsageError> = tab.REPL.qexec(`${value} --help`, undefined, undefined, {
              failWithUsage: true
            })
            if (usage.then) {
              usage.then(handleUsage, handleUsage)
            } else {
              handleUsage(usage)
            }
          } catch (err) {
            console.error(err)
          }
        }
      }
    }
  })
}
