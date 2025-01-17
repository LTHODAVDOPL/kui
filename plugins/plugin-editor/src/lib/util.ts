/*
 * Copyright 2018-19 IBM Corporation
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

import { UI } from '@kui-shell/core'

import { language } from './file-types'
import { save, revert } from './persisters'
import { EditorResponse, EditorState, CommandResponse } from './response'

type ModeFunction = (state: EditorState) => UI.Mode

/**
 * Prepare a response for the REPL. Consumes the output of
 * updateEditor
 *
 */
export const respondToRepl = (extraModes: ModeFunction[] = [], displayOptions = []) => (
  response: EditorResponse
): CommandResponse => {
  const entity = response.getEntity()

  const badges: UI.Badge[] = [{ title: language(entity.exec.kind), css: 'is-kind-like' }]

  const modes: UI.Mode[] = [save(response), revert(response)].concat(extraModes.map(modeFn => modeFn(response)))

  return {
    type: 'custom',
    isEntity: true,
    kind: entity.kind,
    version: entity.version,
    metadata: {
      name: entity.name,
      generation: entity.version || (entity.metadata && entity.metadata.generation),
      namespace: entity.namespace || (entity.metadata && entity.metadata.namespace)
    },
    content: response.content,
    toolbarText: response.toolbarText,
    controlHeaders: ['.header-right-bits'],
    displayOptions: [`entity-is-${entity.type}`, 'edit-mode'].concat(displayOptions),
    noZoom: true,
    badges,
    modes
  }
}

export default respondToRepl
