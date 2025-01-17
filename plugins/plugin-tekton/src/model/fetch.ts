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

import { Errors, UI } from '@kui-shell/core'

import { PipelineRun, Pipeline, Task } from './resource'

/**
 * Get the Pipeline referenced by a PipelineRun
 *
 */
export function getPipelineFromRef(tab: UI.Tab, run: PipelineRun): Promise<Pipeline> {
  return tab.REPL.rexec(`kubectl get Pipeline ${run.spec.pipelineRef.name}`) // want: Pipeline.tekton.dev, but that is much slower
    .catch((err: Errors.CodedError) => {
      if (err.code === 404) {
        return undefined
      } else {
        throw err
      }
    })
}

/**
 * Retrieve all Tasks
 *
 */
export function getTasks(tab: UI.Tab): Promise<Task[]> {
  return tab.REPL.rexec('kubectl get Task') // want Task.tekton.dev, but that is much slower
}
