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

import { Commands, Models } from '@kui-shell/core'

/**
 * export command
 *
 */
const exportCommand = ({ tab, parsedOptions }: Commands.Arguments) => {
  const curDic = Models.SymbolTable.read(tab)

  const toBeParsed = parsedOptions._[1]
  const arr = toBeParsed.split('=')

  curDic[arr[0]] = arr[1]

  Models.SymbolTable.write(tab, curDic)

  return true
}

const usage = {
  command: 'export',
  docs: 'Export a variable or function to the environment of all the child processes running in the current shell'
}

/**
 * Register command handlers
 *
 */
export default (commandTree: Commands.Registrar) => {
  commandTree.listen('/export', exportCommand, { usage, noAuthOk: true, inBrowserOk: true })
}
